import type { AgentResponse } from "@/lib/shopify/types";

const fallback: AgentResponse = {
  intent: "chitchat",
  message: "I can help you browse products and add items to your cart.",
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
