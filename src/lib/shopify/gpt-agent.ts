import type { SessionMessage, ShopifyProduct } from "@/lib/shopify/types";
import { parseAgentResponse } from "@/lib/shopify/intent-parser";
import { getGroqKey, groqChatCompletion, GROQ_CHAT_MODEL } from "@/lib/groq/client";

function buildNoResultsMessage(storeName: string, searchedQuery?: string | null): string {
  const item = searchedQuery?.trim();
  if (item) {
    return `I checked our catalog at ${storeName} and couldn't find anything matching "${item}". We don't sell that item. If you'd like, tell me what you're looking for and I can suggest something similar.`;
  }
  return `I checked our catalog at ${storeName} and couldn't find anything matching that. We don't sell that item. If you'd like, tell me what you're looking for and I can suggest something similar.`;
}

function buildSystemPrompt(
  storeName: string,
  opts: {
    routingIntent?: string;
    cartHint?: string;
    resultMode?: "success" | "clarification" | "partial" | "no_results";
    clarificationQuestion?: string;
    suggestions?: string[];
    searchedQuery?: string | null;
  }
): string {
  let rules = `You are a shopping assistant for ${storeName}.
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

  if (opts.routingIntent === "off_topic") {
    rules +=
      "\n- The shopper may be off-topic; politely redirect them to shopping at this store only.";
  }
  if (opts.cartHint) {
    rules += `\n- ${opts.cartHint}`;
  }
  if (opts.resultMode === "clarification") {
    rules +=
      "\n- Execution needs clarification. Ask one short question and provide suggestions in plain language.";
  }
  if (opts.resultMode === "no_results") {
    const searched = opts.searchedQuery?.trim();
    rules +=
      "\n- The product search has ALREADY finished. The Product context array is empty — no matching items exist in this store's catalog.";
    rules +=
      "\n- Do NOT say you are searching, looking, checking, or fetching. The search is complete.";
    rules +=
      "\n- Clearly tell the shopper we could not find that item and we do not sell it.";
    if (searched) {
      rules += `\n- The shopper searched for: "${searched}". Reference this naturally in your reply.`;
    }
    rules +=
      "\n- Offer to help find something similar, but keep the reply short and realistic.";
  }
  if (opts.clarificationQuestion) {
    rules += `\n- Clarification question to ask: ${opts.clarificationQuestion}`;
  }
  if (opts.suggestions?.length) {
    rules += `\n- Suggest these options: ${opts.suggestions.join(" | ")}`;
  }
  return rules;
}

export async function runAgent(params: {
  storeName: string;
  userMessage: string;
  history: SessionMessage[];
  products: ShopifyProduct[];
  cartAction?: { checkoutUrl: string; totalPrice?: string | null } | null;
  routingIntent?: string;
  resultMode?: "success" | "clarification" | "partial" | "no_results";
  clarification?: { question: string; suggestions: string[] };
  searchedQuery?: string | null;
}) {
  if (
    params.resultMode === "no_results" ||
    (params.routingIntent === "product_search" &&
      params.products.length === 0 &&
      params.resultMode !== "clarification")
  ) {
    if (!getGroqKey()) {
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message: buildNoResultsMessage(params.storeName, params.searchedQuery),
        })
      );
    }
  }

  if (!getGroqKey()) {
    if (params.products.length > 0) {
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message:
            "Here are some products that match. Use Add to cart on a variant, or paste a variant ID if you already have one.",
        })
      );
    }
    if (params.cartAction?.checkoutUrl) {
      return parseAgentResponse(
        JSON.stringify({
          intent: "add_to_cart",
          message: `Your cart was updated. You can continue to checkout here: ${params.cartAction.checkoutUrl}`,
        })
      );
    }
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message:
          "Shop assistant is not fully configured (missing GROQ_API_KEY). Add a key for natural replies.",
      })
    );
  }

  const cartHint = params.cartAction
    ? `Latest cart: total ${params.cartAction.totalPrice ?? "n/a"}, checkout URL: ${params.cartAction.checkoutUrl}`
    : "";

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(params.storeName, {
        routingIntent: params.routingIntent,
        cartHint,
        resultMode: params.resultMode,
        clarificationQuestion: params.clarification?.question,
        suggestions: params.clarification?.suggestions,
        searchedQuery: params.searchedQuery,
      }),
    },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${params.userMessage}\n\nProduct context:\n${JSON.stringify(params.products).slice(0, 3000)}`,
    },
  ];

  const result = await groqChatCompletion({
    model: GROQ_CHAT_MODEL,
    messages,
    max_tokens: 400,
    response_format: { type: "json_object" },
  });

  if (!result.ok) {
    if (params.resultMode === "no_results") {
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message: buildNoResultsMessage(params.storeName, params.searchedQuery),
        })
      );
    }
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message: "I can help you browse products. Please try again in a moment.",
      })
    );
  }

  const agent = parseAgentResponse(result.content);

  if (
    params.resultMode === "no_results" &&
    /\b(searching|looking for|let me (find|search|look)|i('ll| will) (search|look|find))\b/i.test(
      agent.message
    )
  ) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "product_search",
        message: buildNoResultsMessage(params.storeName, params.searchedQuery),
      })
    );
  }

  return agent;
}
