import type {
  AgentResponse,
  ClarificationPayload,
  IntentConfidence,
  SearchSortKey,
  ShopAssistActionPlan,
} from "@/lib/shopify/types";
import type { ParsedFilters } from "@/lib/shopify/storefront";
import { getGroqKey, groqChatCompletion, GROQ_INTENT_MODEL } from "@/lib/groq/client";

const fallback: AgentResponse = {
  intent: "chitchat",
  message: "I can help you browse products and add items to your cart.",
};

export type ParsedIntent = ShopAssistActionPlan & {
  filters?: ParsedFilters;
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
    question: "I can help search products. What would you like to see?",
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

/**
 * Lightweight intent + slot extraction for the ShopAssist pipeline.
 * Uses Groq when GROQ_API_KEY is set; otherwise treats the message as a product search query.
 */
export async function parseIntent(message: string): Promise<ParsedIntent> {
  const trimmed = message.trim();
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

  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You extract shopping intent and execution plan for Shopify Storefront API.
Reply with ONLY a JSON object (no markdown).

Intents:
- product_search: browse/find products
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

Rules:
- "new/latest/recent" => sortKey=CREATED_AT and reverse=true
- "cheap/lowest price" => sortKey=PRICE and reverse=false
- If unclear, set needsClarification=true with clarification.question and 2-4 suggestions.
- If add_to_cart but no variantId, set needsClarification=true.
- confidence: low | medium | high

Example:
{"intent":"product_search","shopifyQuery":"running shoes","sortKey":"RELEVANCE","reverse":false,"filters":{"query":"running shoes","maxPrice":120},"confidence":"high","needsClarification":false}
`,
      },
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
    if (intent === "product_search" && !normalizedQuery && !needsClarification) {
      return {
        ...buildFallbackPlan(trimmed),
        needsClarification: true,
        clarification: defaultClarification(trimmed),
      };
    }

    return {
      intent,
      filters: filters ?? (intent === "product_search" ? { query: normalizedQuery || "products" } : undefined),
      shopifyQuery: intent === "product_search" ? normalizedQuery || "products" : undefined,
      sortKey: intent === "product_search" ? sortKey : undefined,
      reverse: intent === "product_search" ? reverse : undefined,
      variantId,
      quantity,
      confidence,
      needsClarification,
      clarification:
        needsClarification
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
    return buildFallbackPlan(trimmed);
  }
}
