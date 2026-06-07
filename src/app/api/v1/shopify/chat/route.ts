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
  type StorefrontStore,
} from "@/lib/shopify/storefront";
import { parseIntent } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";
import {
  buildProductSuggestions,
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

function pickDefaultVariant(product: ShopifyProduct): string | undefined {
  const available = product.variants.filter((v) => v.available);
  return available.length === 1 ? available[0].id : undefined;
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

  const intent = await parseIntent(parsed.data.message, {
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
  let cartAction: {
    checkoutUrl: string;
    totalPrice?: string | null;
    cartId?: string;
  } | null = null;

  if (intent.intent === "product_search" && !intent.needsClarification) {
    const searchResult = await runProductSearch(storefrontStore, intent, parsed.data.message);
    products = searchResult.products;
    usedSearchQuery = searchResult.usedSearchQuery;
    recovered = searchResult.recovered;
    clarification = undefined;
    sessionContext = applySearchResultsToContext(products, usedSearchQuery, sessionContext);
  } else if (intent.intent === "browse_alternatives") {
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
  } else if (intent.intent === "select_product") {
    const catalog = sessionContext.lastProducts ?? [];
    const selection = resolveProductSelection(parsed.data.message, catalog, {
      productIndex: intent.productIndex,
      productTitle: intent.productTitle,
    });

    if (selection && !intent.needsClarification) {
      const variantId = intent.variantId ?? selection.variantId;
      sessionContext = {
        ...sessionContext,
        stage: variantId ? "awaiting_confirm" : "presenting_options",
        selectedProduct: selection.product,
        selectedVariantId: variantId,
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
  } else if (intent.intent === "confirm_add_to_cart") {
    const variantId = intent.variantId ?? sessionContext.selectedVariantId;
    if (variantId) {
      try {
        const qty = Math.min(10, Math.max(1, intent.quantity ?? 1));
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
        cartAction = {
          checkoutUrl: cart.checkoutUrl,
          totalPrice: cart.totalPrice,
          cartId: cart.cartId,
        };
        sessionContext = {
          ...sessionContext,
          stage: "completed",
        };
        products = sessionContext.selectedProduct ? [sessionContext.selectedProduct] : [];
      } catch (err) {
        console.error(LOG_PREFIX, "confirm add to cart failed", {
          variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (intent.intent === "add_to_cart" && intent.variantId) {
    try {
      const qty = Math.min(10, Math.max(1, intent.quantity ?? 1));
      const cart = await addToCart({
        store: storefrontStore,
        variantId: intent.variantId,
        quantity: qty,
        cartId: session.cartToken,
      });
      await db
        .update(shopChatSessions)
        .set({ cartToken: cart.cartId })
        .where(eq(shopChatSessions.id, session.id));
      session = { ...session, cartToken: cart.cartId };
      cartAction = {
        checkoutUrl: cart.checkoutUrl,
        totalPrice: cart.totalPrice,
        cartId: cart.cartId,
      };
      sessionContext = { ...sessionContext, stage: "completed" };
    } catch (err) {
      console.error(LOG_PREFIX, "storefront add to cart failed", {
        variantId: intent.variantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (intent.intent === "chitchat" && history.length === 0) {
    sessionContext = { ...sessionContext, stage: "greeting" };
  } else {
    products =
      sessionContext.stage === "presenting_options" || sessionContext.stage === "awaiting_confirm"
        ? (sessionContext.lastProducts ?? [])
        : [];
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
    | "cart_added" = "partial";

  if (cartAction) {
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

  const agent = await runAgent({
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
      products,
      cartAction,
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
