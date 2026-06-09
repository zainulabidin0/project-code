import type {
  CartLineItem,
  ChatSessionContext,
  ConversationStage,
  SessionMessage,
  ShopifyProduct,
} from "@/lib/shopify/types";
import { parseAgentResponse } from "@/lib/shopify/intent-parser";
import { getGroqKey, groqChatCompletion, GROQ_CHAT_MODEL } from "@/lib/groq/client";
import {
  buildCheckoutReadyMessage,
  buildCheckoutStartMessage,
  buildEmptyCartCheckoutMessage,
} from "@/lib/shopify/checkout-collector";

function buildNoResultsMessage(storeName: string, searchedQuery?: string | null): string {
  const item = searchedQuery?.trim();
  if (item) {
    return `I checked ${storeName} and we don't sell "${item}". Would you like me to show you some popular items from our store instead?`;
  }
  return `I checked ${storeName} and we don't have that item. Would you like me to show you some popular items from our store instead?`;
}

function formatProductLine(product: ShopifyProduct): string {
  const price = product.price ? `${product.currency ? product.currency + " " : ""}${product.price}`.trim() : "";
  return price ? `${product.title} (${price})` : product.title;
}

function buildSystemPrompt(
  storeName: string,
  opts: {
    routingIntent?: string;
    cartHint?: string;
    resultMode?:
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
      | "checkout_ready";
    clarificationQuestion?: string;
    suggestions?: string[];
    searchedQuery?: string | null;
    conversationStage?: ConversationStage;
    selectedProduct?: ShopifyProduct;
    selectedQuantity?: number;
  }
): string {
  let rules = `You are a friendly in-store sales assistant for ${storeName}.
Respond with strict JSON:
{
  "intent": "product_search|add_to_cart|show_cart|start_checkout|chitchat",
  "message": "assistant response for the shopper",
  "query": "optional search query",
  "variantId": "optional variant id for add_to_cart"
}
Rules:
- Act like a helpful salesperson: warm, natural, concise (1-3 sentences).
- Stay focused on store shopping help only.
- Never say you are searching, looking, or fetching — results are already available.
- Match user language where possible.`;

  if (opts.routingIntent === "off_topic") {
    rules +=
      "\n- The shopper may be off-topic; politely redirect them to shopping at this store only.";
  }
  if (opts.cartHint) {
    rules += `\n- ${opts.cartHint}`;
  }
  if (opts.resultMode === "greeting" || opts.conversationStage === "greeting") {
    rules +=
      '\n- Welcome the shopper warmly and ask: "What would you like to buy today?"';
  }
  if (opts.resultMode === "clarification") {
    rules +=
      "\n- Execution needs clarification. Ask one short question using ONLY the server-provided suggestions below. Do NOT invent product names or categories.";
  }
  if (opts.resultMode === "multi_results") {
    rules +=
      "\n- Multiple products were found. In one natural reply, say how many options you have, briefly list each by name and price, then ask which one they would like.";
  }
  if (opts.resultMode === "success" && opts.selectedProduct) {
    rules += `\n- One product matched: ${formatProductLine(opts.selectedProduct)}. Present it and ask if they would like it added to their cart.`;
  }
  if (opts.resultMode === "confirm_offer" && opts.selectedProduct) {
    const qty = opts.selectedQuantity && opts.selectedQuantity > 1 ? `${opts.selectedQuantity} × ` : "";
    rules += `\n- The shopper chose: ${qty}${formatProductLine(opts.selectedProduct)}. Confirm their choice and ask: "Shall I add it to your cart?"`;
  }
  if (opts.resultMode === "cart_added") {
    rules +=
      "\n- The item was successfully added to cart. Confirm this warmly. Do NOT share a checkout link — delivery details will be collected next.";
  }
  if (opts.resultMode === "show_cart") {
    rules +=
      "\n- You are showing the shopper their current cart contents. List each item with quantity and price clearly. End by asking if they want to checkout or continue shopping.";
  }
  if (opts.resultMode === "variant_selection" && opts.selectedProduct) {
    rules += `\n- The shopper picked ${opts.selectedProduct.title}. List the available sizes/options and ask which one they want. Be brief.`;
  }
  if (opts.resultMode === "awaiting_quantity") {
    rules += "\n- The shopper has chosen their product and variant. Ask simply: 'How many would you like?'";
  }
  if (opts.resultMode === "awaiting_cart_confirm" && opts.selectedProduct) {
    const qty = opts.selectedQuantity ?? 1;
    const item = opts.selectedProduct.title;
    rules += `\n- Confirm the order: ${qty}× ${item}. Show the per-unit price and total. Ask: 'Shall I add this to your cart?'`;
  }
  if (opts.resultMode === "cart_added_pause") {
    rules +=
      "\n- The item was successfully added to cart. Confirm briefly and ask: 'Would you like to checkout?' Do NOT start asking for delivery details yet.";
  }
  if (opts.resultMode === "confirming_saved_address") {
    rules +=
      "\n- You are showing the shopper their previously saved delivery address and asking if they want to use it. Be warm and brief. Say 'Shall I use this address?' or similar.";
  }
  if (opts.resultMode === "collecting_checkout") {
    rules +=
      "\n- You are collecting checkout delivery details one question at a time. Ask ONLY the next required question. Do not share a checkout link yet.";
  }
  if (opts.resultMode === "checkout_ready") {
    rules +=
      "\n- All delivery details are saved. Tell the shopper to tap Complete order to finish on the secure checkout page. Do NOT paste a raw URL.";
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
      "\n- Do NOT invent product types or subcategories (e.g. do not mention beeswax, candle wax, etc. unless they appear in Product context).";
    rules +=
      '\n- End by asking if they would like to see popular items from the store (they can reply "yes" or "show me what you have").';
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
  cartAction?: { checkoutUrl?: string; totalPrice?: string | null; cartId?: string } | null;
  routingIntent?: string;
  resultMode?:
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
    | "checkout_ready";
  clarification?: { question: string; suggestions: string[] };
  searchedQuery?: string | null;
  conversationStage?: ConversationStage;
  selectedProduct?: ShopifyProduct;
  sessionContext?: ChatSessionContext;
  selectedQuantity?: number;
  cartLines?: CartLineItem[];
}) {
  if (
    params.resultMode === "no_results" ||
    (params.routingIntent === "product_search" &&
      params.products.length === 0 &&
      params.resultMode !== "clarification" &&
      params.resultMode !== "greeting")
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

  if (params.resultMode === "greeting" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message: `Welcome to ${params.storeName}! What would you like to buy today?`,
      })
    );
  }

  if (params.resultMode === "confirm_offer" && params.selectedProduct && !getGroqKey()) {
    const line = formatProductLine(params.selectedProduct);
    return parseAgentResponse(
      JSON.stringify({
        intent: "product_search",
        message: `Great choice — ${line}. Shall I add it to your cart?`,
      })
    );
  }

  if (params.resultMode === "cart_added" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "add_to_cart",
        message: `Done! I've added it to your cart. I'll ask a few quick delivery questions next.`,
      })
    );
  }

  if (params.resultMode === "collecting_checkout" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "chitchat",
        message: "What's your full name?",
      })
    );
  }

  if (params.resultMode === "checkout_ready" && params.cartAction?.checkoutUrl && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "start_checkout",
        message: "Thanks! Tap Complete order below to finish checkout.",
      })
    );
  }

  if (params.resultMode === "show_cart" && !getGroqKey()) {
    const lines = params.cartLines ?? [];
    const list = lines.length
      ? lines
          .map(
            (l) =>
              `${l.quantity}× ${l.title}${l.variantTitle !== "Default Title" ? ` (${l.variantTitle})` : ""} — ${l.currency} ${l.price}`
          )
          .join("\n")
      : "Your cart is empty.";
    return parseAgentResponse(
      JSON.stringify({
        intent: "show_cart",
        message: `Here's your cart:\n${list}${params.cartAction?.totalPrice ? `\n\nTotal: ${params.cartAction.totalPrice}` : ""}`,
      })
    );
  }

  if (params.resultMode === "variant_selection" && params.selectedProduct && !getGroqKey()) {
    const options = params.selectedProduct.variants
      .filter((v) => v.available)
      .map((v) => v.title)
      .join(", ");
    return parseAgentResponse(
      JSON.stringify({
        intent: "select_product",
        message: `${params.selectedProduct.title} is available in: ${options}. Which would you like?`,
      })
    );
  }

  if (params.resultMode === "awaiting_quantity" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "select_product",
        message: "How many would you like?",
      })
    );
  }

  if (params.resultMode === "awaiting_cart_confirm" && params.selectedProduct && !getGroqKey()) {
    const qty = params.selectedQuantity ?? 1;
    return parseAgentResponse(
      JSON.stringify({
        intent: "confirm_add_to_cart",
        message: `${qty}× ${params.selectedProduct.title} — shall I add this to your cart?`,
      })
    );
  }

  if (params.resultMode === "cart_added_pause" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "add_to_cart",
        message: "Done! Added to your cart. Would you like to checkout?",
      })
    );
  }

  if (params.resultMode === "confirming_saved_address" && !getGroqKey()) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "start_checkout",
        message: "I have your saved address. Shall I use it for this order?",
      })
    );
  }

  if (!getGroqKey()) {
    if (params.products.length > 1) {
      const list = params.products.map(formatProductLine).join(", ");
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message: `We have ${params.products.length} options: ${list}. Which one would you like?`,
        })
      );
    }
    if (params.products.length > 0) {
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message:
            "Here are some products that match. Use Add to cart on a variant, or tell me which one you'd like.",
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
        conversationStage: params.conversationStage,
        selectedProduct: params.selectedProduct,
        selectedQuantity: params.sessionContext?.selectedQuantity,
      }),
    },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${params.userMessage}\n\nProduct context:\n${JSON.stringify(params.products).slice(0, 3000)}${
        params.cartLines?.length
          ? `\n\nCart lines:\n${JSON.stringify(params.cartLines).slice(0, 2000)}`
          : ""
      }`,
    },
  ];

  const result = await groqChatCompletion({
    model: GROQ_CHAT_MODEL,
    messages,
    max_tokens: 500,
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
    if (params.resultMode === "confirm_offer" && params.selectedProduct) {
      return parseAgentResponse(
        JSON.stringify({
          intent: "product_search",
          message: `Great choice — ${formatProductLine(params.selectedProduct)}. Shall I add it to your cart?`,
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

  if (params.resultMode === "cart_added") {
    const qty = params.selectedQuantity && params.selectedQuantity > 1 ? `${params.selectedQuantity} × ` : "";
    const name = params.selectedProduct?.title ?? "your item";
    return parseAgentResponse(
      JSON.stringify({
        intent: "add_to_cart",
        message: `Done! I've added ${qty}${name} to your cart.`,
      })
    );
  }

  if (params.resultMode === "cart_added_pause") {
    return parseAgentResponse(
      JSON.stringify({
        intent: "add_to_cart",
        message: "Done! Added to your cart. Would you like to checkout?",
      })
    );
  }

  if (params.resultMode === "checkout_ready" && params.cartAction?.checkoutUrl) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "start_checkout",
        message: buildCheckoutReadyMessage(),
      })
    );
  }

  if (
    params.resultMode !== "checkout_ready" &&
    params.resultMode !== "collecting_checkout" &&
    !params.cartAction?.checkoutUrl &&
    /\b(proceed to payment|proceed to pay|your total comes out|please proceed to payment)\b/i.test(
      agent.message
    )
  ) {
    const hasCart = Boolean(params.cartAction?.cartId);
    return parseAgentResponse(
      JSON.stringify({
        intent: "start_checkout",
        message: hasCart
          ? buildCheckoutStartMessage(params.cartAction?.totalPrice ?? undefined)
          : buildEmptyCartCheckoutMessage(),
      })
    );
  }

  if (
    params.resultMode !== "checkout_ready" &&
    params.resultMode !== "collecting_checkout" &&
    !params.cartAction?.checkoutUrl &&
    /\b(added|i've added|added to your cart|added them to your cart)\b/i.test(agent.message)
  ) {
    return parseAgentResponse(
      JSON.stringify({
        intent: "product_search",
        message:
          params.selectedProduct && params.sessionContext?.stage === "awaiting_confirm"
            ? `I haven't added it yet. Say "add to cart" or click the Add to cart button when you're ready.`
            : "I haven't updated your cart yet. Tell me which product you'd like, or use the Add to cart button.",
      })
    );
  }

  return agent;
}
