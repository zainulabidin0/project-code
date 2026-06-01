import type { AgentResponse } from "@/lib/shopify/types";
import type { ParsedFilters } from "@/lib/shopify/storefront";
import { getGroqKey, groqChatCompletion, GROQ_INTENT_MODEL } from "@/lib/groq/client";

const fallback: AgentResponse = {
  intent: "chitchat",
  message: "I can help you browse products and add items to your cart.",
};

export type ParsedIntent = {
  intent:
    | "product_search"
    | "add_to_cart"
    | "show_cart"
    | "start_checkout"
    | "chitchat"
    | "off_topic";
  filters?: ParsedFilters;
  variantId?: string;
  quantity?: number;
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

/**
 * Lightweight intent + slot extraction for the ShopAssist pipeline.
 * Uses Groq when GROQ_API_KEY is set; otherwise treats the message as a product search query.
 */
export async function parseIntent(message: string): Promise<ParsedIntent> {
  const trimmed = message.trim();
  if (!trimmed) return { intent: "chitchat" };

  if (!getGroqKey()) {
    return { intent: "product_search", filters: { query: trimmed } };
  }

  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You extract shopping intent from the user message. Reply with ONLY a JSON object (no markdown).

Intents:
- product_search: browse/find products
- add_to_cart: user wants to add a specific item (include variantId if they pasted a Shopify GID like gid://shopify/ProductVariant/...)
- show_cart: view cart
- start_checkout: pay / checkout
- chitchat: shipping, returns, store help, vague greeting
- off_topic: unrelated to shopping

For product_search, include filters when possible: query (main terms), color, maxPrice, minPrice, category, size.
For add_to_cart include variantId (Shopify GID) and optional quantity (number).

Example: {"intent":"product_search","filters":{"query":"running shoes","maxPrice":120}}`,
      },
      { role: "user", content: trimmed },
    ],
  });

  if (!result.ok) {
    return { intent: "product_search", filters: { query: trimmed } };
  }

  try {
    const parsed = JSON.parse(result.content || "{}") as Record<string, unknown>;
    const intent = coerceIntent(parsed.intent);
    const filters = coerceFilters(parsed.filters);
    const variantId = typeof parsed.variantId === "string" ? parsed.variantId : undefined;
    const quantity = typeof parsed.quantity === "number" ? parsed.quantity : undefined;
    if (intent === "add_to_cart" && !variantId) {
      return { intent: "product_search", filters: { query: trimmed } };
    }
    if (intent === "product_search" && !filters) {
      return { intent: "product_search", filters: { query: trimmed } };
    }
    return { intent, filters: filters ?? undefined, variantId, quantity };
  } catch {
    return { intent: "product_search", filters: { query: trimmed } };
  }
}
