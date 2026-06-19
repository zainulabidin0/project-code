import {
  callNvidiaChat,
  NVIDIA_MODEL,
  type NvidiaChatMessage,
} from "@/lib/shopify/nvidia-client";

export type CheckoutFieldName =
  | "fullName"
  | "email"
  | "phone"
  | "address1"
  | "address2"
  | "city"
  | "zip";

export type PlanAction = {
  type:
    | "search"
    | "add_to_cart"
    | "remove_from_cart"
    | "clear_cart"
    | "get_cart"
    | "save_checkout_field"
    | "update_checkout_field"
    | "build_checkout_url"
    | "none";
  query?: string;
  sort?: "RELEVANCE" | "PRICE_ASC" | "PRICE_DESC" | "BEST_SELLING" | "CREATED_AT_DESC";
  quantity?: number;
  productRef?: "last_searched" | "specific_index" | "cart_item";
  productIndex?: number;
  field?: CheckoutFieldName;
  value?: string;
};

export type Plan = {
  actions: PlanAction[];
  userIntent: "browse" | "buy" | "cart_management" | "checkout" | "chitchat" | "off_topic";
  replyTemplate:
    | "search_results"
    | "single_match_confirm"
    | "added_confirmation"
    | "cart_summary"
    | "cart_cleared"
    | "ask_checkout_field"
    | "checkout_url_ready"
    | "checkout_details_summary"
    | "checkout_field_update"
    | "saved_address_offer"
    | "no_results"
    | "needs_clarification"
    | "off_topic_redirect"
    | "chitchat_reply";
  /** When ask_checkout_field targets a specific field (e.g. user wants to edit address). */
  checkoutField?: CheckoutFieldName;
  clarificationNeeded?: string;
  language: "en" | "ur" | "roman_ur";
};

const SYSTEM_PROMPT = `You are a planning module for a Shopify shopping assistant.
Your ONLY job is to output a JSON plan. Never write conversational text.

Analyze the user's message and current state, then decide:
1. What actions need to run (search, add to cart, save info, etc.)
2. What intent they have (browse vs buy vs checkout vs chitchat)
3. Which reply template fits the situation
4. What language they're using

## RULES FOR ACTIONS

- "I want X" / "show me X" / "looking for X" → browse intent
  actions: [{ type: "search", query: "X" }]
  replyTemplate: "search_results"

- "buy X" / "I want to buy X" / "get me X" / "order X" → buy intent
  actions: [{ type: "search", query: "X" }]
  replyTemplate: "single_match_confirm"

- "buy 2 X" → same as above but note quantity in the search action
  actions: [{ type: "search", query: "X", quantity: 2 }]

- "yes" / "sure" / "add it" / "ok" (when there's a pending product) → confirm add
  actions: [{ type: "add_to_cart", productRef: "last_searched", quantity: <from context or 1> }]
  replyTemplate: "added_confirmation"

- "what's in my cart" / "show cart" →
  actions: [{ type: "get_cart" }]
  replyTemplate: "cart_summary"

- "clear cart" / "empty cart" / "delete everything" / "remove all" →
  actions: [{ type: "clear_cart" }]
  replyTemplate: "cart_cleared"

- "remove X" (specific item) →
  actions: [{ type: "remove_from_cart", productRef: "cart_item" }]
  replyTemplate: "added_confirmation"

- "checkout" / "let's go" / "place order" / "pay now" / "I'm done" / checkout-related Urdu phrases →
  userIntent: "checkout"
  If cart empty: replyTemplate: "no_results"
  If checkout fields incomplete: actions: [] , replyTemplate: "ask_checkout_field"
  If all fields collected AND user is proceeding to complete (NOT reviewing/editing): 
    actions: [{ type: "build_checkout_url" }]
    replyTemplate: "checkout_url_ready"

- "show my details" / "what info do you have" / "ask the checkout details" / "review my order info" / 
  "show my info" / "what did I give you" →
  userIntent: "checkout"
  actions: []
  replyTemplate: "checkout_details_summary"

- "change my X" / "update my X" / "I want to update Y" / "edit my address" / "actually change my city to Lahore"
  (where X/Y is a specific field: name, email, phone, address, city, zip) →
  userIntent: "checkout"
  If new value is provided in the message:
    actions: [{ type: "update_checkout_field", field: "<detected field>", value: "<new value>" }]
    replyTemplate: "checkout_field_update"
  If no new value yet (e.g. "I want to update my address"):
    actions: []
    replyTemplate: "ask_checkout_field"
    checkoutField: "<detected field>"

- When user provides info during INITIAL checkout collection (name/email/phone/address/city/zip):
  actions: [{ type: "save_checkout_field", field: "...", value: "..." }]
  replyTemplate: "ask_checkout_field" OR "saved_address_offer" OR "checkout_url_ready"

## CHECKOUT URL READY — IMPORTANT
Do NOT use checkout_url_ready just because checkoutReady is true in state.
Only use checkout_url_ready when the user message is about completing/proceeding 
(e.g. "let's go", "checkout now", "I'm done", "place order", "pay now").
Review/edit requests MUST use checkout_details_summary, checkout_field_update, or ask_checkout_field — 
NEVER checkout_url_ready.

- Greetings / thanks / small talk →
  userIntent: "chitchat"
  actions: []
  replyTemplate: "chitchat_reply"

- Unrelated to shopping →
  userIntent: "off_topic"
  actions: []
  replyTemplate: "off_topic_redirect"

- If the message is genuinely ambiguous →
  replyTemplate: "needs_clarification"
  clarificationNeeded: "<describe what's unclear>"

## LANGUAGE DETECTION
Detect if the message is English, Urdu (Arabic script), or Roman Urdu (Urdu in Latin letters).
Set the language field accordingly.

## OUTPUT FORMAT
Respond with ONLY valid JSON matching the Plan interface. No markdown, no explanation.`;

function formatHistory(history: Array<{ role: string; content: string }>): string {
  return history.slice(-6).map((h) => `${h.role}: ${h.content}`).join("\n");
}

function extractJson(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
}

export type PlanResult = {
  plan: Plan;
  usage?: { total_tokens?: number };
};

export async function generatePlan(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  stateSnapshot: string
): Promise<PlanResult> {
  const messages: NvidiaChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `## Conversation history (last 6 turns)\n${formatHistory(history)}\n\n## Current state\n${stateSnapshot}\n\n## User message\n"${userMessage}"\n\nOutput the JSON plan now.`,
    },
  ];

  const response = await callNvidiaChat({
    model: NVIDIA_MODEL,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 400,
  });

  if (!response.ok) {
    console.error("[planner] NVIDIA API failed", { status: response.status });
    return {
      plan: {
        actions: [{ type: "search", query: userMessage }],
        userIntent: "browse",
        replyTemplate: "search_results",
        language: "en",
      },
    };
  }

  console.log("[planner] token usage", {
    total_tokens: response.usage?.total_tokens,
    model: NVIDIA_MODEL,
  });

  try {
    return {
      plan: JSON.parse(extractJson(response.content)) as Plan,
      usage: response.usage,
    };
  } catch {
    console.error("[planner] Failed to parse plan JSON:", response.content);
    return {
      plan: {
        actions: [{ type: "search", query: userMessage }],
        userIntent: "browse",
        replyTemplate: "search_results",
        language: "en",
      },
      usage: response.usage,
    };
  }
}
