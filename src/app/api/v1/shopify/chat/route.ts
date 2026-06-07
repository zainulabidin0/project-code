import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { shopChatSessions, shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import {
  getOrCreateSession,
  parseMessages,
  parseSessionContext,
  saveSessionState,
} from "@/lib/shopify/session";
import { runAgent } from "@/lib/shopify/gpt-agent";
import {
  type ProductSearchPlan,
  StorefrontRequestError,
  searchProducts,
  addToCart,
  applyCheckoutDetailsToCart,
  getCartCheckoutUrl,
  getCartSummary,
  type StorefrontStore,
} from "@/lib/shopify/storefront";
import { parseIntent } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";
import {
  beginCheckoutFromExistingCart,
  buildCheckoutReadyMessage,
  buildCheckoutResumeMessage,
  buildEmptyCartCheckoutMessage,
  buildSessionAfterCartAdd,
  processCheckoutAnswer,
  toCartCheckoutDetails,
} from "@/lib/shopify/checkout-collector";
import {
  buildProductSuggestions,
  isDirectCartAddRequest,
  parseRequestedQuantity,
  pickDefaultVariant,
  productsForDisplay,
  resolveProductSelection,
} from "@/lib/shopify/product-selection";
import type { ChatSessionContext, SessionMessage, ShopifyProduct } from "@/lib/shopify/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  sessionToken: z.string().min(8),
});

const LOG_PREFIX = "[shopify/chat]";

function mapIntentToQuery(plan: Awaited<ReturnType<typeof parseIntent>>, fallbackMessage: string): ProductSearchPlan {
  return {
    query: plan.shopifyQuery || plan.filters?.query || fallbackMessage,
    sortKey: plan.sortKey,
    reverse: plan.reverse,
    first: 5,
  };
}

function applySearchResultsToContext(
  products: ShopifyProduct[],
  usedSearchQuery: string | null,
  priorContext: ReturnType<typeof parseSessionContext>
): ChatSessionContext {
  if (products.length === 0) {
    return {
      stage: "no_results",
      lastSearchQuery: usedSearchQuery ?? priorContext.lastSearchQuery,
      lastProducts: undefined,
      selectedProduct: undefined,
      selectedVariantId: undefined,
    };
  }
  if (products.length === 1) {
    const single = products[0];
    const variantId = pickDefaultVariant(single);
    return {
      stage: variantId ? "awaiting_confirm" : "presenting_options",
      lastProducts: products,
      lastSearchQuery: usedSearchQuery ?? undefined,
      selectedProduct: single,
      selectedVariantId: variantId,
    };
  }
  return {
    stage: "presenting_options",
    lastProducts: products,
    lastSearchQuery: usedSearchQuery ?? undefined,
    selectedProduct: undefined,
    selectedVariantId: undefined,
  };
}

function catalogBackedClarification(
  clarification: Awaited<ReturnType<typeof parseIntent>>["clarification"],
  products: ShopifyProduct[],
  selectedProduct?: ShopifyProduct
) {
  if (!clarification) return undefined;
  if (selectedProduct) {
    const variantTitles = new Set(
      selectedProduct.variants.filter((v) => v.available).map((v) => v.title)
    );
    if (clarification.suggestions.every((s) => variantTitles.has(s))) {
      return clarification;
    }
  }
  if (products.length === 0) return undefined;
  return clarification;
}

async function runProductSearch(
  storefrontStore: StorefrontStore,
  intent: Awaited<ReturnType<typeof parseIntent>>,
  userMessage: string
): Promise<{
  products: ShopifyProduct[];
  usedSearchQuery: string | null;
  recovered: boolean;
}> {
  let products: ShopifyProduct[] = [];
  let usedSearchQuery: string | null = null;
  let recovered = false;

  const searchPlan = mapIntentToQuery(intent, userMessage);
  const storefrontQuery = searchPlan.query;
  usedSearchQuery = storefrontQuery;

  console.log(LOG_PREFIX, "storefront GraphQL search starting", {
    shopDomain: storefrontStore.shopDomain,
    plan: searchPlan,
  });

  try {
    products = await searchProducts(storefrontStore, searchPlan);
    console.log(LOG_PREFIX, "storefront GraphQL search result", {
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        currency: p.currency,
        variantCount: p.variants.length,
      })),
    });
  } catch (err) {
    console.error(LOG_PREFIX, "storefront GraphQL search failed", {
      shopDomain: storefrontStore.shopDomain,
      query: storefrontQuery,
      error: err instanceof Error ? err.message : String(err),
      status: err instanceof StorefrontRequestError ? err.status : undefined,
      bodySnippet: err instanceof StorefrontRequestError ? err.bodySnippet : undefined,
    });

    if (err instanceof StorefrontRequestError && err.status === 400) {
      const recovery = await recoverSearchPlan({
        userMessage,
        initialPlan: intent,
        failedQuery: storefrontQuery,
        errorMessage: err.message,
      });
      console.log(LOG_PREFIX, "search recovery result", recovery);
      if (recovery.status === "rewritten") {
        try {
          recovered = true;
          usedSearchQuery = recovery.plan.shopifyQuery ?? usedSearchQuery;
          products = await searchProducts(storefrontStore, {
            query: recovery.plan.shopifyQuery || userMessage,
            sortKey: recovery.plan.sortKey,
            reverse: recovery.plan.reverse,
            first: 5,
          });
        } catch (retryErr) {
          console.error(LOG_PREFIX, "storefront GraphQL recovery failed", {
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          products = [];
        }
      } else {
        products = [];
      }
    } else {
      products = [];
    }
  }

  return { products, usedSearchQuery, recovered };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const shopDomain = req.headers.get("x-shop-domain")?.trim();
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  console.log(LOG_PREFIX, "request", { shopDomain });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) {
    console.warn(LOG_PREFIX, "store not found", { shopDomain });
    return jsonError("NOT_FOUND", "Shopify store is not configured", 404);
  }
  if (store.authStatus === "REAUTH_REQUIRED") {
    return jsonError("UNAUTHORIZED", "Shopify connection requires re-authentication", 401);
  }

  const storefrontStore: StorefrontStore = {
    id: store.id,
    shopDomain: store.shopDomain,
    storefrontToken: store.storefrontToken,
  };

  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) {
    return jsonError("RATE_LIMITED", `Monthly quota exceeded for ${quota.plan} plan`, 429);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let session = await getOrCreateSession(store.id, parsed.data.sessionToken, ip);
  const history = parseMessages(session.messages);
  let sessionContext = parseSessionContext(session.sessionContext);
  let assistantMessageOverride: string | undefined;
  let checkoutOnlyTurn = false;
  let cartAction: {
    checkoutUrl?: string;
    totalPrice?: string | null;
    cartId?: string;
  } | null = null;

  if (
    sessionContext.stage === "collecting_checkout" &&
    sessionContext.checkoutField &&
    sessionContext.checkoutDraft &&
    session.cartToken
  ) {
    checkoutOnlyTurn = true;
    const step = processCheckoutAnswer(
      sessionContext.checkoutDraft,
      sessionContext.checkoutField,
      parsed.data.message
    );

    if (step.status === "invalid" || step.status === "next") {
      sessionContext = {
        ...sessionContext,
        checkoutDraft: step.draft,
        checkoutField: step.field,
        stage: "collecting_checkout",
      };
      assistantMessageOverride = step.message;
    } else {
      try {
        const applied = await applyCheckoutDetailsToCart({
          store: storefrontStore,
          cartId: session.cartToken,
          details: toCartCheckoutDetails(step.draft),
        });
        sessionContext = {
          ...sessionContext,
          checkoutDraft: step.draft,
          checkoutField: undefined,
          stage: "checkout_ready",
        };
        cartAction = {
          checkoutUrl: applied.checkoutUrl,
          cartId: session.cartToken,
        };
        assistantMessageOverride = step.message;
      } catch (err) {
        console.error(LOG_PREFIX, "apply checkout details failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        const fallbackUrl = await getCartCheckoutUrl({
          store: storefrontStore,
          cartId: session.cartToken,
        }).catch(() => null);
        if (fallbackUrl) {
          cartAction = { checkoutUrl: fallbackUrl, cartId: session.cartToken };
        }
        assistantMessageOverride =
          "I saved what I could, but some delivery details couldn't be applied automatically. Tap Complete order to finish the rest on checkout.";
        sessionContext = {
          ...sessionContext,
          checkoutDraft: step.draft,
          stage: "checkout_ready",
        };
      }
    }
  }

  const intent = checkoutOnlyTurn
    ? { intent: "chitchat" as const, confidence: "high" as const, needsClarification: false }
    : await parseIntent(parsed.data.message, {
        history,
        context: sessionContext,
      });

  console.log(LOG_PREFIX, "intent parsed", {
    intent: intent.intent,
    shopifyQuery: intent.shopifyQuery,
    productIndex: intent.productIndex,
    variantId: intent.variantId,
    stage: sessionContext.stage,
    needsClarification: intent.needsClarification,
  });

  let products: ShopifyProduct[] = [];
  let usedSearchQuery: string | null = sessionContext.lastSearchQuery ?? null;
  let recovered = false;
  let clarification = intent.clarification;

  if (!checkoutOnlyTurn && intent.intent === "product_search" && !intent.needsClarification) {
    const searchResult = await runProductSearch(storefrontStore, intent, parsed.data.message);
    products = searchResult.products;
    usedSearchQuery = searchResult.usedSearchQuery;
    recovered = searchResult.recovered;
    clarification = undefined;
    sessionContext = applySearchResultsToContext(products, usedSearchQuery, sessionContext);
  } else if (!checkoutOnlyTurn && intent.intent === "browse_alternatives") {
    const searchResult = await runProductSearch(
      storefrontStore,
      {
        intent: "browse_alternatives",
        shopifyQuery: "*",
        sortKey: intent.sortKey ?? "BEST_SELLING",
        reverse: intent.reverse ?? false,
        confidence: "high",
        needsClarification: false,
      },
      parsed.data.message
    );
    products = searchResult.products;
    usedSearchQuery = "popular products";
    recovered = searchResult.recovered;
    clarification = undefined;
    sessionContext = applySearchResultsToContext(products, usedSearchQuery, sessionContext);
  } else if (!checkoutOnlyTurn && intent.intent === "select_product") {
    if (intent.quantity && sessionContext.selectedProduct) {
      const selected = sessionContext.selectedProduct;
      sessionContext = {
        ...sessionContext,
        selectedQuantity: intent.quantity,
        stage: sessionContext.selectedVariantId ? "awaiting_confirm" : sessionContext.stage,
      };
      products = [selected];
    } else {
    const catalog = sessionContext.lastProducts ?? [];
    const selection = resolveProductSelection(parsed.data.message, catalog, {
      productIndex: intent.productIndex,
      productTitle: intent.productTitle,
    });

    if (selection && !intent.needsClarification) {
      const variantId = intent.variantId ?? selection.variantId;
      const quantity = intent.quantity ?? sessionContext.selectedQuantity;
      sessionContext = {
        ...sessionContext,
        stage: variantId ? "awaiting_confirm" : "presenting_options",
        selectedProduct: selection.product,
        selectedVariantId: variantId,
        selectedQuantity: quantity,
      };
      products = [selection.product];
    } else if (selection && intent.needsClarification) {
      sessionContext = {
        ...sessionContext,
        stage: "presenting_options",
        selectedProduct: selection.product,
        selectedVariantId: undefined,
      };
      products = [selection.product];
      clarification = intent.clarification;
    } else if (intent.variantId && sessionContext.selectedProduct) {
      const selected = sessionContext.selectedProduct;
      sessionContext = {
        ...sessionContext,
        stage: "awaiting_confirm",
        selectedVariantId: intent.variantId,
      };
      products = [selected];
    } else {
      products = sessionContext.lastProducts ?? [];
    }
    }
  } else if (intent.intent === "confirm_add_to_cart" || intent.intent === "add_to_cart") {
    const variantId =
      intent.variantId ??
      sessionContext.selectedVariantId ??
      (sessionContext.selectedProduct ? pickDefaultVariant(sessionContext.selectedProduct) : undefined);
    if (variantId) {
      try {
        const qty = Math.min(
          10,
          Math.max(1, intent.quantity ?? sessionContext.selectedQuantity ?? 1)
        );
        const cart = await addToCart({
          store: storefrontStore,
          variantId,
          quantity: qty,
          cartId: session.cartToken,
        });
        await db
          .update(shopChatSessions)
          .set({ cartToken: cart.cartId })
          .where(eq(shopChatSessions.id, session.id));
        session = { ...session, cartToken: cart.cartId };
        const afterAdd = buildSessionAfterCartAdd({
          sessionContext,
          cart: { cartId: cart.cartId, totalPrice: cart.totalPrice },
          variantId,
          quantity: qty,
        });
        cartAction = afterAdd.cartAction;
        sessionContext = afterAdd.sessionContext;
        assistantMessageOverride = afterAdd.introMessage;
        products = sessionContext.selectedProduct ? [sessionContext.selectedProduct] : [];
      } catch (err) {
        console.error(LOG_PREFIX, "confirm add to cart failed", {
          variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (!checkoutOnlyTurn && intent.intent === "start_checkout") {
    if (!session.cartToken) {
      assistantMessageOverride = buildEmptyCartCheckoutMessage();
    } else {
      const summary = await getCartSummary({
        store: storefrontStore,
        cartId: session.cartToken,
      }).catch(() => null);

      if (sessionContext.stage === "checkout_ready") {
        if (summary) {
          cartAction = {
            checkoutUrl: summary.checkoutUrl,
            cartId: session.cartToken,
            totalPrice: summary.totalPrice,
          };
        }
        assistantMessageOverride = buildCheckoutReadyMessage();
      } else if (
        sessionContext.stage === "collecting_checkout" &&
        sessionContext.checkoutField
      ) {
        if (summary) {
          cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
        }
        assistantMessageOverride = buildCheckoutResumeMessage(sessionContext.checkoutField);
      } else {
        const checkoutStart = beginCheckoutFromExistingCart(summary?.totalPrice ?? undefined);
        sessionContext = {
          ...sessionContext,
          stage: "collecting_checkout",
          checkoutDraft: checkoutStart.draft,
          checkoutField: checkoutStart.field,
        };
        if (summary) {
          cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
        }
        assistantMessageOverride = checkoutStart.message;
      }
    }
    if (sessionContext.selectedProduct) {
      products = [sessionContext.selectedProduct];
    }
  } else if (intent.intent === "chitchat" && history.length === 0) {
    sessionContext = { ...sessionContext, stage: "greeting" };
  } else if (sessionContext.stage === "awaiting_confirm" && sessionContext.selectedProduct) {
    if (intent.quantity) {
      sessionContext = { ...sessionContext, selectedQuantity: intent.quantity };
    }
    products = [sessionContext.selectedProduct!];
  } else if (sessionContext.stage === "presenting_options") {
    products = sessionContext.lastProducts ?? [];
  } else {
    products = [];
  }

  if (
    !cartAction &&
    sessionContext.selectedProduct &&
    isDirectCartAddRequest(parsed.data.message)
  ) {
    const variantId =
      sessionContext.selectedVariantId ??
      pickDefaultVariant(sessionContext.selectedProduct);
    if (variantId) {
      try {
        const qty = Math.min(
          10,
          Math.max(
            1,
            intent.quantity ??
              parseRequestedQuantity(parsed.data.message) ??
              sessionContext.selectedQuantity ??
              1
          )
        );
        const cart = await addToCart({
          store: storefrontStore,
          variantId,
          quantity: qty,
          cartId: session.cartToken,
        });
        await db
          .update(shopChatSessions)
          .set({ cartToken: cart.cartId })
          .where(eq(shopChatSessions.id, session.id));
        session = { ...session, cartToken: cart.cartId };
        const afterAdd = buildSessionAfterCartAdd({
          sessionContext,
          cart: { cartId: cart.cartId, totalPrice: cart.totalPrice },
          variantId,
          quantity: qty,
        });
        cartAction = afterAdd.cartAction;
        sessionContext = afterAdd.sessionContext;
        assistantMessageOverride = afterAdd.introMessage;
        products = [sessionContext.selectedProduct!];
      } catch (err) {
        console.error(LOG_PREFIX, "direct cart add fallback failed", {
          variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  clarification = catalogBackedClarification(
    clarification,
    products,
    sessionContext.selectedProduct
  );

  let resultMode:
    | "success"
    | "clarification"
    | "partial"
    | "no_results"
    | "multi_results"
    | "greeting"
    | "confirm_offer"
    | "cart_added"
    | "collecting_checkout"
    | "checkout_ready" = "partial";

  if (sessionContext.stage === "checkout_ready" && cartAction?.checkoutUrl) {
    resultMode = "checkout_ready";
  } else if (sessionContext.stage === "collecting_checkout") {
    resultMode = "collecting_checkout";
  } else if (cartAction) {
    resultMode = "cart_added";
  } else if (intent.intent === "chitchat" && sessionContext.stage === "greeting" && history.length === 0) {
    resultMode = "greeting";
  } else if (sessionContext.stage === "awaiting_confirm" && sessionContext.selectedProduct) {
    resultMode = "confirm_offer";
  } else if (
    (intent.intent === "product_search" || sessionContext.stage === "no_results") &&
    products.length === 0
  ) {
    resultMode = "no_results";
  } else if (intent.intent === "browse_alternatives" && products.length > 0) {
    resultMode = products.length > 1 ? "multi_results" : "success";
  } else if (clarification) {
    resultMode = "clarification";
  } else if (products.length > 1) {
    resultMode = "multi_results";
  } else if (products.length === 1) {
    resultMode = "success";
  }

  const agent = assistantMessageOverride
    ? { intent: "chitchat" as const, message: assistantMessageOverride }
    : await runAgent({
        storeName: store.storeName ?? store.shopDomain,
        userMessage: parsed.data.message,
        history,
        products,
        cartAction,
        routingIntent: intent.intent,
        resultMode,
        clarification,
        searchedQuery: usedSearchQuery,
        conversationStage: sessionContext.stage,
        selectedProduct: sessionContext.selectedProduct,
        sessionContext,
        selectedQuantity: sessionContext.selectedQuantity,
      });

  console.log(LOG_PREFIX, "agent reply", {
    intent: agent.intent,
    resultMode,
    stage: sessionContext.stage,
    messagePreview: agent.message.slice(0, 120),
  });

  const nextMessages: SessionMessage[] = [
    ...history,
    { role: "user" as const, content: parsed.data.message },
    { role: "assistant" as const, content: agent.message },
  ].slice(-20);

  await saveSessionState(session.id, nextMessages, sessionContext);

  const displayProducts = productsForDisplay(sessionContext, products);

  const productSuggestions =
    sessionContext.stage === "presenting_options" && sessionContext.lastProducts?.length
      ? buildProductSuggestions(sessionContext.lastProducts)
      : [];

  const processingMs = Date.now() - startedAt;
  await db.insert(shopUsageLogs).values({
    projectId: store.projectId,
    storeId: store.id,
    sessionId: session.id,
    actionType: "chat",
    tokensUsed: 0,
    processingMs,
    status: "SUCCESS",
  });

  return NextResponse.json({
    success: true,
    data: {
      message: agent.message,
      intent: intent.intent,
      intentAgent: agent.intent,
      products: displayProducts,
      cartAction,
      checkoutReady: sessionContext.stage === "checkout_ready" && Boolean(cartAction?.checkoutUrl),
      needsClarification: Boolean(clarification),
      clarificationQuestion: clarification?.question,
      suggestions: clarification?.suggestions ?? [],
      productSuggestions,
      conversationStage: sessionContext.stage,
      selectedProduct: sessionContext.selectedProduct,
      agentTrace: {
        intent: intent.intent,
        usedQuery: usedSearchQuery,
        sortKey: intent.sortKey ?? null,
        recovered,
        stage: sessionContext.stage,
      },
      sessionToken: parsed.data.sessionToken,
    },
  });
}
