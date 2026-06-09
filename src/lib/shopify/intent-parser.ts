import type {
  AgentResponse,
  ChatSessionContext,
  ClarificationPayload,
  IntentConfidence,
  SearchSortKey,
  SessionMessage,
  ShopAssistActionPlan,
} from "@/lib/shopify/types";
import type { ParsedFilters } from "@/lib/shopify/storefront";
import { getGroqKey, groqChatCompletion, GROQ_INTENT_MODEL } from "@/lib/groq/client";
import {
  isBrowseAlternativesRequest,
  isConfirmYes,
  isDirectCartAddRequest,
  isPurchaseIntent,
  isQuantityOnlyMessage,
  isShowCartIntent,
  isVagueGreeting,
  parseRequestedQuantity,
  pickDefaultVariant,
  resolveProductSelection,
  resolveVariantFromMessage,
} from "@/lib/shopify/product-selection";
import { isCheckoutIntent } from "@/lib/shopify/checkout-collector";

const fallback: AgentResponse = {
  intent: "chitchat",
  message: "I can help you browse products and add items to your cart.",
};

export type ParsedIntent = ShopAssistActionPlan & {
  filters?: ParsedFilters;
};

export type ParseIntentOptions = {
  history?: SessionMessage[];
  context?: ChatSessionContext;
};

export function parseAgentResponse(raw: string | null | undefined): AgentResponse {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentResponse>;
    if (!parsed.message || !parsed.intent) return fallback;
    return {
      intent: parsed.intent,
      message: parsed.message,
      query: parsed.query,
      variantId: parsed.variantId,
    };
  } catch {
    return { ...fallback, message: raw.slice(0, 500) };
  }
}

function coerceIntent(value: unknown): ParsedIntent["intent"] {
  const v = typeof value === "string" ? value : "";
  if (
    v === "product_search" ||
    v === "browse_alternatives" ||
    v === "select_product" ||
    v === "confirm_add_to_cart" ||
    v === "add_to_cart" ||
    v === "show_cart" ||
    v === "start_checkout" ||
    v === "chitchat" ||
    v === "off_topic"
  ) {
    return v;
  }
  return "chitchat";
}

function coerceSortKey(value: unknown): SearchSortKey | undefined {
  if (value === "RELEVANCE" || value === "CREATED_AT" || value === "PRICE" || value === "BEST_SELLING") {
    return value;
  }
  return undefined;
}

function coerceConfidence(value: unknown): IntentConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

export function normalizeShopifyQuery(raw: string): string {
  const query = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\b(show|me|some|please|can|you|i|want|find|search|for|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return query.slice(0, 120);
}

export function inferSortHints(message: string): { sortKey?: SearchSortKey; reverse?: boolean } {
  const text = message.toLowerCase();
  if (/\b(new|latest|just arrived|recent)\b/.test(text)) {
    return { sortKey: "CREATED_AT", reverse: true };
  }
  if (/\b(cheap|lowest|low price|budget)\b/.test(text)) {
    return { sortKey: "PRICE", reverse: false };
  }
  if (/\b(expensive|premium|high price)\b/.test(text)) {
    return { sortKey: "PRICE", reverse: true };
  }
  if (/\b(best selling|popular|top selling)\b/.test(text)) {
    return { sortKey: "BEST_SELLING", reverse: false };
  }
  return { sortKey: "RELEVANCE", reverse: false };
}

function defaultClarification(message: string): ClarificationPayload {
  const hints = inferSortHints(message);
  if (hints.sortKey === "CREATED_AT") {
    return {
      question: "Do you want me to show your latest products?",
      suggestions: ["Show latest products", "Show best selling products", "Show products under $50"],
    };
  }
  return {
    question: "What would you like to buy today?",
    suggestions: ["Show latest products", "Show best selling products", "Show products under $50"],
  };
}

function coerceFilters(raw: unknown): ParsedFilters | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const query = typeof o.query === "string" ? o.query : "";
  const color = typeof o.color === "string" ? o.color : undefined;
  const category = typeof o.category === "string" ? o.category : undefined;
  const size = typeof o.size === "string" ? o.size : undefined;
  const maxPrice = typeof o.maxPrice === "number" ? o.maxPrice : undefined;
  const minPrice = typeof o.minPrice === "number" ? o.minPrice : undefined;
  if (!query.trim() && !color && maxPrice == null && minPrice == null && !category && !size) {
    return undefined;
  }
  return { query: query.trim() || " ", color, maxPrice, minPrice, category, size };
}

export function buildFallbackPlan(message: string): ParsedIntent {
  const normalized = normalizeShopifyQuery(message);
  const hints = inferSortHints(message);
  return {
    intent: "product_search",
    filters: { query: normalized || message.trim() || "products" },
    shopifyQuery: normalized || "products",
    sortKey: hints.sortKey,
    reverse: hints.reverse,
    confidence: normalized ? "medium" : "low",
    needsClarification: false,
  };
}

function buildContextSummary(context?: ChatSessionContext): string {
  if (!context) return "";
  const lines: string[] = [`Conversation stage: ${context.stage}`];
  if (context.lastSearchQuery) lines.push(`Last search: ${context.lastSearchQuery}`);
  if (context.lastProducts?.length) {
    lines.push(
      "Products shown:",
      ...context.lastProducts.map((p, i) => `${i + 1}. ${p.title} (${p.price} ${p.currency})`)
    );
  }
  if (context.selectedProduct) {
    lines.push(`Selected product: ${context.selectedProduct.title}`);
  }
  return lines.join("\n");
}

function ruleBasedIntent(message: string, opts?: ParseIntentOptions): ParsedIntent | null {
  const trimmed = message.trim();
  const context = opts?.context;
  const history = opts?.history ?? [];

  if (!trimmed) {
    return { intent: "chitchat", confidence: "high", needsClarification: false };
  }

  if (isShowCartIntent(trimmed)) {
    return {
      intent: "show_cart",
      confidence: "high",
      needsClarification: false,
    };
  }

  if (context?.stage === "cart_added_pause") {
    if (isCheckoutIntent(trimmed) || isConfirmYes(trimmed)) {
      return {
        intent: "start_checkout",
        confidence: "high",
        needsClarification: false,
      };
    }
    if (/\b(no|nope|keep|continue|more|shop|nahi|nai)\b/i.test(trimmed)) {
      return {
        intent: "chitchat",
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (context?.stage === "awaiting_cart_confirm" && context.selectedProduct) {
    if (isConfirmYes(trimmed)) {
      const variantId = context.selectedVariantId ?? pickDefaultVariant(context.selectedProduct);
      if (variantId) {
        return {
          intent: "confirm_add_to_cart",
          variantId,
          quantity: context.selectedQuantity ?? 1,
          confidence: "high",
          needsClarification: false,
        };
      }
    }
    if (/^(no|nope|cancel|nevermind|never mind|nahi|nai)\b/i.test(trimmed)) {
      return {
        intent: "chitchat",
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (context?.stage === "awaiting_quantity" && context.selectedProduct) {
    const qty = isQuantityOnlyMessage(trimmed) ?? parseRequestedQuantity(trimmed);
    if (qty) {
      return {
        intent: "select_product",
        productTitle: context.selectedProduct.title,
        variantId: context.selectedVariantId,
        quantity: qty,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (context?.stage === "selecting_variant" && context.selectedProduct) {
    const variantId = resolveVariantFromMessage(trimmed, context.selectedProduct);
    if (variantId) {
      return {
        intent: "select_product",
        productTitle: context.selectedProduct.title,
        variantId,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (
    context?.stage !== "collecting_checkout" &&
    context?.stage !== "cart_added_pause" &&
    isCheckoutIntent(trimmed)
  ) {
    return {
      intent: "start_checkout",
      confidence: "high",
      needsClarification: false,
    };
  }

  if (
    context?.selectedProduct &&
    isDirectCartAddRequest(trimmed) &&
    context.stage !== "selecting_variant" &&
    context.stage !== "awaiting_quantity" &&
    context.stage !== "awaiting_cart_confirm" &&
    context.stage !== "cart_added_pause"
  ) {
    const qty = parseRequestedQuantity(trimmed);
    const variantId =
      context.selectedVariantId ?? pickDefaultVariant(context.selectedProduct);
    if (variantId) {
      return {
        intent: "confirm_add_to_cart",
        variantId,
        quantity: qty ?? context.selectedQuantity ?? 1,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (context?.stage === "awaiting_confirm" && context.selectedProduct) {
    const qty = parseRequestedQuantity(trimmed);
    if (qty || (isPurchaseIntent(trimmed) && !isDirectCartAddRequest(trimmed))) {
      return {
        intent: "select_product",
        productTitle: context.selectedProduct.title,
        variantId: context.selectedVariantId,
        quantity: qty ?? context.selectedQuantity,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (context?.stage === "no_results" && isBrowseAlternativesRequest(trimmed)) {
    return {
      intent: "browse_alternatives",
      sortKey: "BEST_SELLING",
      reverse: false,
      confidence: "high",
      needsClarification: false,
    };
  }

  if (context?.selectedProduct && !context.selectedVariantId) {
    const variantId = resolveVariantFromMessage(trimmed, context.selectedProduct);
    if (variantId) {
      return {
        intent: "select_product",
        productTitle: context.selectedProduct.title,
        variantId,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (
    context?.stage === "presenting_options" &&
    context.lastProducts?.length
  ) {
    const selection = resolveProductSelection(trimmed, context.lastProducts);
    if (selection) {
      if (selection.needsVariantChoice) {
        return {
          intent: "select_product",
          productIndex: selection.productIndex,
          productTitle: selection.product.title,
          confidence: "high",
          needsClarification: true,
          clarification: {
            question: `Which size or option for ${selection.product.title}?`,
            suggestions: selection.product.variants
              .filter((v) => v.available)
              .slice(0, 4)
              .map((v) => v.title),
          },
        };
      }
      return {
        intent: "select_product",
        productIndex: selection.productIndex,
        productTitle: selection.product.title,
        variantId: selection.variantId,
        confidence: "high",
        needsClarification: false,
      };
    }
  }

  if (history.length === 0 && isVagueGreeting(trimmed)) {
    return { intent: "chitchat", confidence: "high", needsClarification: false };
  }

  return null;
}

function buildIntentSystemPrompt(context?: ChatSessionContext): string {
  const contextBlock = buildContextSummary(context);
  return `You extract shopping intent and execution plan for Shopify Storefront API.
Reply with ONLY a JSON object (no markdown).

Intents:
- product_search: browse/find products by keyword
- browse_alternatives: shopper wants to see other/popular products after a failed search (use when stage is no_results and they say yes/show me something else)
- select_product: shopper picks from previously shown products (include productIndex 0-based or productTitle)
- confirm_add_to_cart: shopper confirms yes/add it when a product was already selected
- add_to_cart: user wants to add a specific item (include variantId if they pasted a Shopify GID like gid://shopify/ProductVariant/...)
- show_cart: view cart
- start_checkout: pay / checkout
- chitchat: shipping, returns, store help, vague greeting
- off_topic: unrelated to shopping

For product_search include:
- shopifyQuery: keyword-only query for Shopify search (never a full sentence)
- sortKey: RELEVANCE | CREATED_AT | PRICE | BEST_SELLING
- reverse: boolean
- optional filters: query, color, maxPrice, minPrice, category, size

For select_product include:
- productIndex: number (0-based index from shown products)
- productTitle: string when obvious

Rules:
- If stage is no_results and user agrees to see other items or asks what else you have, use browse_alternatives (NOT product_search with invented subcategories)
- If stage is presenting_options and user picks an item, use select_product
- If stage is awaiting_confirm and user says yes/add it, use confirm_add_to_cart
- NEVER set needsClarification with product-type suggestions unless those products are already listed in context Products shown
- Do NOT invent product categories the store may not carry
- "new/latest/recent" => sortKey=CREATED_AT and reverse=true
- "cheap/lowest price" => sortKey=PRICE and reverse=false
- If add_to_cart but no variantId, set needsClarification=true with variant options only
- confidence: low | medium | high

${contextBlock ? `Session context:\n${contextBlock}` : ""}`;
}

/**
 * Lightweight intent + slot extraction for the ShopAssist pipeline.
 * Uses Groq when GROQ_API_KEY is set; otherwise treats the message as a product search query.
 */
export async function parseIntent(message: string, opts?: ParseIntentOptions): Promise<ParsedIntent> {
  const trimmed = message.trim();
  const ruleResult = ruleBasedIntent(trimmed, opts);
  if (ruleResult) return ruleResult;

  if (!trimmed) {
    return {
      intent: "chitchat",
      confidence: "high",
      needsClarification: false,
    };
  }

  if (!getGroqKey()) {
    return buildFallbackPlan(trimmed);
  }

  const historyMessages = (opts?.history ?? []).slice(-6).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildIntentSystemPrompt(opts?.context) },
      ...historyMessages,
      { role: "user", content: trimmed },
    ],
  });

  if (!result.ok) {
    return buildFallbackPlan(trimmed);
  }

  try {
    const parsed = JSON.parse(result.content || "{}") as Record<string, unknown>;
    const intent = coerceIntent(parsed.intent);
    const filters = coerceFilters(parsed.filters);
    const rawShopifyQuery = typeof parsed.shopifyQuery === "string" ? parsed.shopifyQuery : "";
    const queryFromFilters = filters?.query ?? "";
    const normalizedQuery =
      normalizeShopifyQuery(rawShopifyQuery) || normalizeShopifyQuery(queryFromFilters) || normalizeShopifyQuery(trimmed);
    const sortKey = coerceSortKey(parsed.sortKey) ?? inferSortHints(trimmed).sortKey ?? "RELEVANCE";
    const reverse =
      typeof parsed.reverse === "boolean" ? parsed.reverse : inferSortHints(trimmed).reverse ?? false;
    const variantId = typeof parsed.variantId === "string" ? parsed.variantId : undefined;
    const productIndex =
      typeof parsed.productIndex === "number" && Number.isFinite(parsed.productIndex)
        ? Math.max(0, Math.round(parsed.productIndex))
        : undefined;
    const productTitle = typeof parsed.productTitle === "string" ? parsed.productTitle : undefined;
    const quantity =
      typeof parsed.quantity === "number" && Number.isFinite(parsed.quantity)
        ? Math.max(1, Math.min(10, Math.round(parsed.quantity)))
        : undefined;
    const confidence = coerceConfidence(parsed.confidence);
    const needsClarification = Boolean(parsed.needsClarification);
    const clarificationRaw =
      parsed.clarification && typeof parsed.clarification === "object"
        ? (parsed.clarification as Record<string, unknown>)
        : undefined;
    const clarificationQuestion =
      typeof clarificationRaw?.question === "string" ? clarificationRaw.question.trim() : "";
    const clarificationSuggestions = Array.isArray(clarificationRaw?.suggestions)
      ? clarificationRaw!.suggestions.filter((v): v is string => typeof v === "string").slice(0, 4)
      : [];

    if (intent === "add_to_cart" && !variantId) {
      return {
        ...buildFallbackPlan(trimmed),
        needsClarification: true,
        clarification: {
          question: "Which size or variant should I add to cart?",
          suggestions: ["Show available variants", "Show latest products", "Show my cart"],
        },
      };
    }

    if (intent === "select_product" && opts?.context?.lastProducts?.length) {
      const selection = resolveProductSelection(trimmed, opts.context.lastProducts, {
        productIndex,
        productTitle,
      });
      if (selection) {
        if (selection.needsVariantChoice && !variantId) {
          return {
            intent: "select_product",
            productIndex: selection.productIndex,
            productTitle: selection.product.title,
            confidence: "high",
            needsClarification: true,
            clarification: {
              question: `Which size or option for ${selection.product.title}?`,
              suggestions: selection.product.variants
                .filter((v) => v.available)
                .slice(0, 4)
                .map((v) => v.title),
            },
          };
        }
        return {
          intent: "select_product",
          productIndex: selection.productIndex,
          productTitle: selection.product.title,
          variantId: variantId ?? selection.variantId,
          confidence: "high",
          needsClarification: false,
        };
      }
    }

    if (intent === "product_search" && !normalizedQuery && !needsClarification) {
      if (opts?.context?.stage === "no_results" && isBrowseAlternativesRequest(trimmed)) {
        return {
          intent: "browse_alternatives",
          sortKey: "BEST_SELLING",
          reverse: false,
          confidence: "high",
          needsClarification: false,
        };
      }
      return {
        ...buildFallbackPlan(trimmed),
        needsClarification: false,
      };
    }

    const hasCatalog = Boolean(opts?.context?.lastProducts?.length);
    const allowClarification =
      needsClarification &&
      (hasCatalog ||
        (intent === "select_product" && Boolean(opts?.context?.selectedProduct)));

    return {
      intent,
      filters: filters ?? (intent === "product_search" ? { query: normalizedQuery || "products" } : undefined),
      shopifyQuery: intent === "product_search" ? normalizedQuery || "products" : undefined,
      sortKey: intent === "product_search" || intent === "browse_alternatives" ? sortKey : undefined,
      reverse: intent === "product_search" || intent === "browse_alternatives" ? reverse : undefined,
      variantId,
      productIndex,
      productTitle,
      quantity,
      confidence,
      needsClarification: allowClarification,
      clarification:
        allowClarification
          ? {
              question: clarificationQuestion || defaultClarification(trimmed).question,
              suggestions:
                clarificationSuggestions.length > 0
                  ? clarificationSuggestions
                  : defaultClarification(trimmed).suggestions,
            }
          : undefined,
    };
  } catch {
    if (opts?.context?.stage === "no_results" && isBrowseAlternativesRequest(trimmed)) {
      return {
        intent: "browse_alternatives",
        sortKey: "BEST_SELLING",
        reverse: false,
        confidence: "high",
        needsClarification: false,
      };
    }
    return buildFallbackPlan(trimmed);
  }
}
