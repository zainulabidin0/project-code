import type { SessionMessage, ShopifyProduct } from "@/lib/shopify/types";
import { parseAgentResponse } from "@/lib/shopify/intent-parser";

function buildSystemPrompt(storeName: string): string {
  return `You are a shopping assistant for ${storeName}.
Respond with strict JSON:
{
  "intent": "product_search|add_to_cart|show_cart|start_checkout|chitchat",
  "message": "assistant response for the shopper",
  "query": "optional search query",
  "variantId": "optional variant id for add_to_cart"
}
Rules:
- Stay focused on store shopping help only.
- Be concise and friendly.
- If user asks to search items, set intent=product_search with useful query.
- If user asks to add a known item, set intent=add_to_cart.
- Match user language where possible.`;
}

export async function runAgent(params: {
  storeName: string;
  userMessage: string;
  history: SessionMessage[];
  products: ShopifyProduct[];
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message: "Shop assistant is not configured yet.",
      })
    );
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(params.storeName) },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${params.userMessage}\n\nProduct context:\n${JSON.stringify(params.products).slice(0, 3000)}`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message: "I can help you browse products. Please try again in a moment.",
      })
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  return parseAgentResponse(content);
}
