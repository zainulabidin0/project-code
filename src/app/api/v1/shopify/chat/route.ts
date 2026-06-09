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
  getCartSummary,
  getCartWithLines,
  type StorefrontStore,
} from "@/lib/shopify/storefront";
import { parseIntent } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";
import {
  beginCheckoutFresh,
  beginCheckoutWithSavedDraft,
  buildCheckoutApplyFailedMessage,
  buildCheckoutReadyMessage,
  buildCheckoutResumeMessage,
  buildEmptyCartCheckoutMessage,
  buildSavedAddressSummary,
  buildSessionAfterCartAdd,
  buildUseSavedAddressPrompt,
  DEFAULT_COUNTRY_CODE,
  isCheckoutDraftComplete,
  isShowSavedDetailsRequest,
  normalizePhoneE164,
  processCheckoutAnswer,
  toCartCheckoutDetails,
} from "@/lib/shopify/checkout-collector";
import {
  findProfileByDraft,
  getSavedCustomerProfile,
  upsertCustomerProfile,
} from "@/lib/shopify/customer-profile";
import {
  buildProductSuggestions,
  filterProductsBySearchRelevance,
  parseRequestedQuantity,
  pickDefaultVariant,
  productsForDisplay,
  resolveProductSelection,
  shouldFilterSearchResults,
} from "@/lib/shopify/product-selection";
import type {
  CartLineItem,
  ChatSessionContext,
  CheckoutDraft,
  SessionMessage,
  ShopifyProduct,
} from "@/lib/shopify/types";

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
  userMessage: string,
  options?: { filterRelevance?: boolean }
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

  if (
    options?.filterRelevance &&
    shouldFilterSearchResults(usedSearchQuery) &&
    products.length > 0
  ) {
    const before = products.length;
    products = filterProductsBySearchRelevance(products, usedSearchQuery ?? userMessage);
    if (before > products.length) {
      console.log(LOG_PREFIX, "search relevance filter applied", {
        query: usedSearchQuery,
        before,
        after: products.length,
      });
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
  let cartLines: CartLineItem[] = [];

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

    if (step.status === "invalid") {
      sessionContext = {
        ...sessionContext,
        checkoutDraft: step.draft,
        checkoutField: step.field,
        stage: "collecting_checkout",
      };
      assistantMessageOverride = step.message;
    } else if (
      step.status === "next" &&
      sessionContext.checkoutField === "email" &&
      step.draft.email
    ) {
      const savedProfile = await getSavedCustomerProfile({
        storeId: store.id,
        identifier: step.draft.email,
      }).catch(() => null);

      if (savedProfile && isCheckoutDraftComplete(savedProfile)) {
        const mergedDraft: CheckoutDraft = {
          ...savedProfile,
          email: step.draft.email,
          countryCode: savedProfile.countryCode ?? DEFAULT_COUNTRY_CODE,
        };
        const summaryMsg = buildSavedAddressSummary(mergedDraft);
        sessionContext = {
          ...sessionContext,
          stage: "confirming_saved_address",
          checkoutDraft: mergedDraft,
          checkoutField: undefined,
        };
        assistantMessageOverride = `Got it! I found your saved delivery details:\n\n${summaryMsg}\n\nShall I use this address?`;
        checkoutOnlyTurn = true;
      } else {
        sessionContext = {
          ...sessionContext,
          checkoutDraft: step.draft,
          checkoutField: step.field,
          stage: "collecting_checkout",
        };
        assistantMessageOverride = step.message;
      }
    } else if (step.status === "next") {
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
        assistantMessageOverride = buildCheckoutReadyMessage(step.draft);

        try {
          const draft = step.draft;
          const identifier = draft.email
            ? draft.email.toLowerCase().trim()
            : draft.phone
              ? normalizePhoneE164(draft.phone)
              : null;

          if (identifier) {
            await upsertCustomerProfile({
              storeId: store.id,
              identifier,
              identifierType: draft.email ? "email" : "phone",
              draft,
            });
          }
        } catch (profileErr) {
          console.error(LOG_PREFIX, "upsertCustomerProfile failed", {
            error: profileErr instanceof Error ? profileErr.message : String(profileErr),
          });
        }
      } catch (err) {
        console.error(LOG_PREFIX, "apply checkout details failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sessionContext = {
          ...sessionContext,
          checkoutDraft: step.draft,
          checkoutField: undefined,
          stage: "collecting_checkout",
        };
        assistantMessageOverride = buildCheckoutApplyFailedMessage();
      }
    }
  }

  if (
    sessionContext.stage === "checkout_ready" &&
    session.cartToken &&
    !cartAction?.checkoutUrl
  ) {
    const summary = await getCartSummary({
      store: storefrontStore,
      cartId: session.cartToken,
    }).catch(() => null);
    if (summary) {
      cartAction = {
        checkoutUrl: summary.checkoutUrl,
        cartId: session.cartToken,
        totalPrice: summary.totalPrice,
      };
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
  let includeProductCards = false;
  let usedSearchQuery: string | null = sessionContext.lastSearchQuery ?? null;
  let recovered = false;
  let clarification = intent.clarification;

  if (!checkoutOnlyTurn && intent.intent === "product_search" && !intent.needsClarification) {
    const searchResult = await runProductSearch(storefrontStore, intent, parsed.data.message, {
      filterRelevance: true,
    });
    products = searchResult.products;
    usedSearchQuery = searchResult.usedSearchQuery;
    recovered = searchResult.recovered;
    clarification = undefined;
    sessionContext = applySearchResultsToContext(products, usedSearchQuery, sessionContext);
    includeProductCards = products.length > 0;
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
    includeProductCards = products.length > 0;
  } else if (!checkoutOnlyTurn && intent.intent === "select_product") {
    const catalog = sessionContext.lastProducts ?? [];

    if (intent.quantity && sessionContext.selectedProduct && sessionContext.selectedVariantId) {
      const selected = sessionContext.selectedProduct;
      sessionContext = {
        ...sessionContext,
        selectedQuantity: intent.quantity,
        stage: "awaiting_cart_confirm",
      };
      products = [selected];
    } else if (
      (sessionContext.stage === "selecting_variant" || sessionContext.stage === "awaiting_quantity") &&
      sessionContext.selectedProduct &&
      intent.variantId
    ) {
      const selected = sessionContext.selectedProduct;
      sessionContext = {
        ...sessionContext,
        selectedVariantId: intent.variantId,
        stage: "awaiting_quantity",
      };
      products = [selected];
    } else {
      const selection = resolveProductSelection(parsed.data.message, catalog, {
        productIndex: intent.productIndex,
        productTitle: intent.productTitle,
      });

      if (selection && !intent.needsClarification) {
        const variantId = intent.variantId ?? selection.variantId;

        if (selection.needsVariantChoice && !variantId) {
          sessionContext = {
            ...sessionContext,
            stage: "selecting_variant",
            selectedProduct: selection.product,
            selectedVariantId: undefined,
          };
          products = [selection.product];
          clarification = {
            question: `Which option for ${selection.product.title}?`,
            suggestions: selection.product.variants
              .filter((v) => v.available)
              .slice(0, 4)
              .map((v) => v.title),
          };
        } else {
          sessionContext = {
            ...sessionContext,
            stage: "awaiting_quantity",
            selectedProduct: selection.product,
            selectedVariantId: variantId,
            selectedQuantity: intent.quantity,
          };
          products = [selection.product];
        }
      } else if (selection && intent.needsClarification) {
        sessionContext = {
          ...sessionContext,
          stage: "selecting_variant",
          selectedProduct: selection.product,
          selectedVariantId: undefined,
        };
        products = [selection.product];
        clarification = intent.clarification;
      } else if (intent.variantId && sessionContext.selectedProduct) {
        const selected = sessionContext.selectedProduct;
        sessionContext = {
          ...sessionContext,
          stage: "awaiting_quantity",
          selectedVariantId: intent.variantId,
        };
        products = [selected];
      } else {
        products = [];
      }
    }
    includeProductCards = products.length > 0;
  } else if (intent.intent === "confirm_add_to_cart" || intent.intent === "add_to_cart") {
    if (
      sessionContext.stage === "awaiting_quantity" &&
      (intent.quantity || parseRequestedQuantity(parsed.data.message))
    ) {
      const qty = intent.quantity ?? parseRequestedQuantity(parsed.data.message) ?? 1;
      sessionContext = {
        ...sessionContext,
        stage: "awaiting_cart_confirm",
        selectedQuantity: qty,
      };
      products = sessionContext.selectedProduct ? [sessionContext.selectedProduct] : [];
      includeProductCards = products.length > 0;
    } else {
      const variantId =
        intent.variantId ??
        sessionContext.selectedVariantId ??
        (sessionContext.selectedProduct ? pickDefaultVariant(sessionContext.selectedProduct) : undefined);

      if (variantId) {
        try {
          const qty = Math.min(10, Math.max(1, intent.quantity ?? sessionContext.selectedQuantity ?? 1));
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
          products = [];
          includeProductCards = false;
        } catch (err) {
          console.error(LOG_PREFIX, "add to cart failed", {
            variantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } else if (
    !checkoutOnlyTurn &&
    sessionContext.checkoutDraft &&
    isShowSavedDetailsRequest(parsed.data.message)
  ) {
    assistantMessageOverride = `Here's what I have saved:\n\n${buildSavedAddressSummary(sessionContext.checkoutDraft)}`;
    products = [];
    includeProductCards = false;
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
        assistantMessageOverride = buildCheckoutReadyMessage(sessionContext.checkoutDraft);
      } else if (
        sessionContext.stage === "collecting_checkout" &&
        !sessionContext.checkoutField &&
        sessionContext.checkoutDraft &&
        isCheckoutDraftComplete(sessionContext.checkoutDraft)
      ) {
        try {
          const applied = await applyCheckoutDetailsToCart({
            store: storefrontStore,
            cartId: session.cartToken,
            details: toCartCheckoutDetails(sessionContext.checkoutDraft),
          });
          sessionContext = {
            ...sessionContext,
            stage: "checkout_ready",
            checkoutField: undefined,
          };
          cartAction = {
            checkoutUrl: applied.checkoutUrl,
            cartId: session.cartToken,
            totalPrice: summary?.totalPrice,
          };
          assistantMessageOverride = buildCheckoutReadyMessage(sessionContext.checkoutDraft);
        } catch (err) {
          console.error(LOG_PREFIX, "retry apply checkout details failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          assistantMessageOverride = buildCheckoutApplyFailedMessage();
        }
      } else if (
        sessionContext.stage === "collecting_checkout" &&
        sessionContext.checkoutField
      ) {
        if (summary) {
          cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
        }
        assistantMessageOverride = buildCheckoutResumeMessage(sessionContext.checkoutField);
      } else if (sessionContext.stage === "confirming_saved_address") {
        const draft = sessionContext.checkoutDraft;
        if (draft && session.cartToken) {
          try {
            const applied = await applyCheckoutDetailsToCart({
              store: storefrontStore,
              cartId: session.cartToken,
              details: toCartCheckoutDetails(draft),
            });
            sessionContext = {
              ...sessionContext,
              stage: "checkout_ready",
              checkoutField: undefined,
            };
            cartAction = {
              checkoutUrl: applied.checkoutUrl,
              cartId: session.cartToken,
              totalPrice: summary?.totalPrice,
            };
            assistantMessageOverride = buildCheckoutReadyMessage(draft);
          } catch (err) {
            console.error(LOG_PREFIX, "apply saved draft to cart failed", {
              error: err instanceof Error ? err.message : String(err),
            });
            assistantMessageOverride = `${buildUseSavedAddressPrompt(draft, summary?.totalPrice ?? undefined)}\n\n(I had trouble applying your details — please reply yes to try again, or no to enter a new address.)`;
          }
        }
      } else {
        const existingDraft = sessionContext.checkoutDraft;
        const savedProfile = existingDraft
          ? await findProfileByDraft({
              storeId: store.id,
              draft: existingDraft,
            }).catch(() => null)
          : null;

        if (savedProfile && isCheckoutDraftComplete(savedProfile)) {
          const checkoutStart = beginCheckoutWithSavedDraft(
            savedProfile,
            summary?.totalPrice ?? undefined
          );
          sessionContext = {
            ...sessionContext,
            stage: "confirming_saved_address",
            checkoutDraft: savedProfile,
            checkoutField: undefined,
          };
          if (summary) {
            cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
          }
          assistantMessageOverride = checkoutStart.message;
        } else {
          const freshStart = beginCheckoutFresh(summary?.totalPrice ?? undefined);
          sessionContext = {
            ...sessionContext,
            stage: "collecting_checkout",
            checkoutDraft: freshStart.draft,
            checkoutField: freshStart.field,
          };
          if (summary) {
            cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
          }
          assistantMessageOverride = freshStart.message;
        }
      }
    }
    products = [];
    includeProductCards = false;
  } else if (!checkoutOnlyTurn && intent.intent === "show_cart") {
    if (!session.cartToken) {
      assistantMessageOverride = "Your cart is empty right now. Tell me what you'd like to buy!";
    } else {
      const cartData = await getCartWithLines({
        store: storefrontStore,
        cartId: session.cartToken,
      }).catch(() => null);

      if (!cartData || cartData.lines.length === 0) {
        assistantMessageOverride = "Your cart is empty right now. Tell me what you'd like to buy!";
      } else {
        cartLines = cartData.lines;
        cartAction = {
          checkoutUrl: cartData.checkoutUrl,
          totalPrice: cartData.totalPrice,
          cartId: session.cartToken,
        };
      }
    }
    products = [];
    includeProductCards = false;
  } else if (intent.intent === "chitchat" && sessionContext.stage === "awaiting_cart_confirm") {
    sessionContext = {
      ...sessionContext,
      stage: sessionContext.lastProducts?.length ? "presenting_options" : "greeting",
      selectedQuantity: undefined,
    };
    products = [];
    includeProductCards = false;
  } else if (intent.intent === "chitchat" && sessionContext.stage === "cart_added_pause") {
    sessionContext = {
      ...sessionContext,
      stage: sessionContext.lastProducts?.length ? "presenting_options" : "greeting",
    };
    products = [];
    includeProductCards = false;
  } else if (intent.intent === "chitchat" && sessionContext.stage === "confirming_saved_address") {
    const summary = session.cartToken
      ? await getCartSummary({ store: storefrontStore, cartId: session.cartToken }).catch(() => null)
      : null;
    const freshStart = beginCheckoutFresh(summary?.totalPrice ?? undefined);
    sessionContext = {
      ...sessionContext,
      stage: "collecting_checkout",
      checkoutDraft: freshStart.draft,
      checkoutField: freshStart.field,
    };
    assistantMessageOverride = freshStart.message;
    products = [];
    includeProductCards = false;
  } else if (intent.intent === "chitchat" && history.length === 0) {
    sessionContext = { ...sessionContext, stage: "greeting" };
  } else if (sessionContext.stage === "cart_added_pause") {
    if (session.cartToken) {
      const summary = await getCartSummary({
        store: storefrontStore,
        cartId: session.cartToken,
      }).catch(() => null);
      if (summary) cartAction = { cartId: session.cartToken, totalPrice: summary.totalPrice };
    }
    products = [];
    includeProductCards = false;
  } else {
    products = [];
    includeProductCards = false;
  }

  if (checkoutOnlyTurn) {
    products = [];
    includeProductCards = false;
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
    | "cart_added_pause"
    | "show_cart"
    | "variant_selection"
    | "awaiting_quantity"
    | "awaiting_cart_confirm"
    | "confirming_saved_address"
    | "collecting_checkout"
    | "checkout_ready" = "partial";

  if (intent.intent === "show_cart" && !assistantMessageOverride) {
    resultMode = "show_cart";
  } else if (sessionContext.stage === "checkout_ready" && cartAction?.checkoutUrl) {
    resultMode = "checkout_ready";
  } else if (sessionContext.stage === "confirming_saved_address") {
    resultMode = "confirming_saved_address";
  } else if (sessionContext.stage === "collecting_checkout") {
    resultMode = "collecting_checkout";
  } else if (sessionContext.stage === "cart_added_pause") {
    resultMode = "cart_added_pause";
  } else if (sessionContext.stage === "awaiting_cart_confirm" && sessionContext.selectedProduct) {
    resultMode = "awaiting_cart_confirm";
  } else if (sessionContext.stage === "awaiting_quantity") {
    resultMode = "awaiting_quantity";
  } else if (sessionContext.stage === "selecting_variant" && sessionContext.selectedProduct) {
    resultMode = "variant_selection";
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
        cartLines,
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

  const displayProducts = productsForDisplay(products, includeProductCards);

  const productSuggestions =
    includeProductCards &&
    sessionContext.stage === "presenting_options" &&
    sessionContext.lastProducts?.length
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
