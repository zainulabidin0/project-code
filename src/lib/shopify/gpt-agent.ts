import {
  getGroqKey,
  groqChatCompletionWithTools,
  GROQ_CHAT_MODEL,
  type GroqChatMessageWithTools,
  type GroqChatTool,
} from "@/lib/groq/client";
import {
  buildSavedAddressSummary,
  createInitialCheckoutDraft,
  normalizeProvinceCode,
  parseCheckoutAnswer,
  type CheckoutField,
} from "@/lib/shopify/checkout-collector";
import { buildCheckoutUrl, getMissingFields } from "@/lib/shopify/checkout-url-builder";
import { getSavedCustomerProfile, upsertCustomerProfile } from "@/lib/shopify/customer-profile";
import { normalizeEmailInput } from "@/lib/shopify/email-normalizer";
import { normalizeFullNameInput } from "@/lib/shopify/name-normalizer";
import {
  addToCart,
  cartLinesRemove,
  getCartCheckoutUrl,
  getCartWithLines,
  searchProducts,
  toCartSummary,
} from "@/lib/shopify/storefront";
import type {
  AgentContext,
  CartAction,
  CartSummary,
  SearchSortKey,
  SessionMessage,
  ShopifyProduct,
} from "@/lib/shopify/types";

export type { AgentContext };

export const FALLBACK_REPLY = "Sorry, I couldn't complete that. Please try again.";

const FORCE_TOOL_USE_PREFIX = `IMPORTANT: You MUST respond by calling a tool.
Do not write any text response. Call the most appropriate tool now based on
the user's message. If unsure, call search_products.`;

const MAX_ITERATIONS = 6;

const EMPTY_TOOL_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export type AgentLoopInput = {
  userMessage: string;
  history: SessionMessage[];
  context: AgentContext;
  storeName: string;
  maxIterations?: number;
};

export type AgentLoopOutput = {
  reply: string;
  updatedContext: AgentContext;
  toolsUsed: string[];
  products: ShopifyProduct[];
  checkoutReady: boolean;
  cartAction: CartAction | null;
};

const TOOLS: GroqChatTool[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store catalog. Call whenever the customer mentions any product, category, or item they want. Also call to browse alternatives when no results found.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search terms e.g. 'wireless charger', 'blue running shoes'",
          },
          sort: {
            type: "string",
            enum: ["RELEVANCE", "PRICE_ASC", "PRICE_DESC", "BEST_SELLING", "CREATED_AT_DESC"],
            description:
              "PRICE_ASC=cheapest first, BEST_SELLING=popular, CREATED_AT_DESC=newest",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add a product to cart. Call after customer confirms they want a product OR when they say 'sure', 'yes', 'add it', 'okay'. Pick the best matching variant automatically. If multiple very different variants exist (like S/M/L/XL) and customer hasn't specified, ask first.",
      parameters: {
        type: "object",
        properties: {
          variantId: { type: "string", description: "Shopify variant GID" },
          quantity: { type: "number", description: "How many to add. Default 1." },
          productTitle: { type: "string", description: "Product name for confirmation" },
          price: { type: "string", description: "Unit price for display" },
        },
        required: ["variantId", "quantity", "productTitle", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cart",
      description:
        "Get current cart contents and total. Call when customer asks about cart or before starting checkout.",
      parameters: { ...EMPTY_TOOL_PARAMETERS, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_cart",
      description:
        "Remove ALL items from cart. Call when customer says 'clear cart', 'empty cart', 'delete everything', 'start over', 'remove all'.",
      parameters: { ...EMPTY_TOOL_PARAMETERS, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_cart_item",
      description: "Remove a specific item from cart.",
      parameters: {
        type: "object",
        properties: {
          lineId: { type: "string", description: "Cart line item GID to remove" },
          productTitle: { type: "string", description: "Product name for confirmation" },
        },
        required: ["lineId", "productTitle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_checkout_info",
      description:
        "Save checkout details the customer provides. Call as soon as the customer gives any piece of info (name, email, phone, address etc). Call once per field, immediately when the customer provides it.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["fullName", "email", "phone", "address1", "address2", "city", "province", "zip"],
          },
          value: { type: "string" },
        },
        required: ["field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_saved_address",
      description:
        "Check if customer has a saved delivery address. Call this after saving their email.",
      parameters: {
        type: "object",
        properties: { email: { type: "string" } },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_saved_address",
      description:
        "Apply the customer's previously saved address to the cart. Call when customer says yes to using saved address.",
      parameters: {
        type: "object",
        properties: { email: { type: "string" } },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_checkout_url",
      description: `Build the final prefilled checkout URL and mark order as ready.
      Call this ONLY when you have collected ALL required fields:
      fullName, email, phone, address1, city, zip.
      address2 is optional. province is auto-inferred from city for Pakistan.`,
      parameters: { ...EMPTY_TOOL_PARAMETERS, required: [] },
    },
  },
];

function mapToolSort(sort?: string): { sortKey: SearchSortKey; reverse: boolean } {
  switch (sort) {
    case "PRICE_ASC":
      return { sortKey: "PRICE", reverse: false };
    case "PRICE_DESC":
      return { sortKey: "PRICE", reverse: true };
    case "BEST_SELLING":
      return { sortKey: "BEST_SELLING", reverse: false };
    case "CREATED_AT_DESC":
      return { sortKey: "CREATED_AT", reverse: true };
    default:
      return { sortKey: "RELEVANCE", reverse: false };
  }
}

function formatCartInfo(cartSummary: CartSummary | null): string {
  if (!cartSummary || cartSummary.itemCount === 0) return "Cart: Empty";
  const total = cartSummary.total ?? "unknown";
  return `Cart: ${cartSummary.itemCount} items, Total: PKR ${total}`;
}

function buildSystemPrompt(storeName: string, context: AgentContext, forceTools: boolean): string {
  const base = buildSystemPromptBody(storeName, context);
  if (!forceTools) return base;
  return `${FORCE_TOOL_USE_PREFIX}\n\n${base}`;
}

function buildSystemPromptBody(storeName: string, context: AgentContext): string {
  const checkoutProgress = context.checkoutDraft
    ? Object.entries(context.checkoutDraft)
        .filter(([key, value]) => key !== "countryCode" && Boolean(value))
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ")
    : "None collected yet";

  return `You are a friendly, efficient AI sales assistant for ${storeName}.
Your personality: helpful, concise, like a good salesman — not a chatbot.

## YOUR GOAL
Help customers find products, add to cart, and complete checkout as smoothly as possible.
Minimize the number of messages. Do the work, then confirm.

## HOW TO HANDLE SHOPPING REQUESTS
- Customer mentions ANY product → call search_products immediately
- After searching: pick the BEST match yourself, show it with price
- If customer says "buy", "order", "get me", "I want" → they want to buy, not just browse
- For buy intent: search → find best match → quote price → ask "Want me to add it?"
- Never make customer type "the first one" or "add it" — make it easy with yes/no
- Always show total price when quantity > 1 (e.g. "2x PKR 1199 = PKR 2398 total")

## CHECKOUT FLOW — FOLLOW THIS EXACTLY

When user says checkout / pay / place order / let's go:

STEP 1 — Check cart
  Call get_cart first. If cart is empty, tell user to add items first.

STEP 2 — Collect details one at a time (conversationally)
  Ask naturally, one field per message:
  - "What's your full name?"
  - "What's your email?"
  - "Phone number?"
  - "Street address?"
  - "City?"
  - "Zip/postal code?"

  As soon as user provides a value → call save_checkout_info immediately.
  After saving email → call lookup_saved_address.
  If saved address found → ask "I have your saved address: X. Use it?"
  If yes → call apply_saved_address → skip address fields → go to STEP 3.

STEP 3 — Build checkout URL
  When ALL required fields collected (fullName, email, phone, address1, city, zip):
  Call build_checkout_url immediately.
  Then reply: "All set! Tap the button below to complete your order."
  Do NOT paste the URL as text — the widget shows the button automatically.

REQUIRED FIELDS: fullName, email, phone, address1, city, zip
OPTIONAL FIELDS: address2 (skip if user says 'none' or 'skip')
DEFAULT COUNTRY: Pakistan (PK) — never ask for country
PROVINCE: auto-inferred from city — never ask for province

## HOW TO HANDLE CART OPERATIONS
- "Clear/empty/delete cart" → call clear_cart immediately, confirm after
- "Remove X" → call remove_cart_item for that specific item
- "What's in my cart" → call get_cart

## RESPONSE STYLE
- Short and friendly. Max 3 sentences per reply.
- Don't say "I'm searching" or "Please wait" — just do it and report back
- Don't repeat product info already shown in cards
- Use PKR for prices (this store is Pakistan-based)
- If customer writes in Urdu/Roman Urdu → reply in the same style
- Never paste raw URLs — the widget shows a "Complete Order" button automatically

## CURRENT STATE
${formatCartInfo(context.cartSummary)}
Checkout info collected: ${checkoutProgress}
Checkout ready: ${context.checkoutReady ? "YES — share checkout link" : "No"}`;
}

async function refreshCartSummary(context: AgentContext): Promise<CartSummary | null> {
  if (!context.cartId) return null;
  const cart = await getCartWithLines({
    store: context.storefrontStore,
    cartId: context.cartId,
  });
  if (!cart) return null;
  return toCartSummary(cart);
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<{ result: Record<string, unknown>; contextUpdates: Partial<AgentContext> }> {
  const contextUpdates: Partial<AgentContext> = {};

  switch (name) {
    case "search_products": {
      const { sortKey, reverse } = mapToolSort(typeof args.sort === "string" ? args.sort : undefined);
      const products = await searchProducts(context.storefrontStore, {
        query: String(args.query ?? ""),
        sortKey,
        reverse,
        first: 5,
      });
      return { result: { products, count: products.length }, contextUpdates };
    }

    case "add_to_cart": {
      const quantity = Math.min(10, Math.max(1, Number(args.quantity) || 1));
      const cartResult = await addToCart({
        store: context.storefrontStore,
        cartId: context.cartId,
        variantId: String(args.variantId ?? ""),
        quantity,
      });
      contextUpdates.cartId = cartResult.cartId;
      contextUpdates.lastAddedProduct = {
        title: String(args.productTitle ?? ""),
        price: String(args.price ?? ""),
        quantity,
      };
      contextUpdates.checkoutReady = false;
      contextUpdates.cartAction = {
        checkoutUrl: cartResult.checkoutUrl,
        totalPrice: cartResult.totalPrice,
        cartId: cartResult.cartId,
      };
      const summary = await getCartWithLines({
        store: context.storefrontStore,
        cartId: cartResult.cartId,
      });
      if (summary) contextUpdates.cartSummary = toCartSummary(summary);
      return {
        result: {
          success: true,
          cartId: cartResult.cartId,
          checkoutUrl: cartResult.checkoutUrl,
        },
        contextUpdates,
      };
    }

    case "get_cart": {
      if (!context.cartId) {
        contextUpdates.cartSummary = null;
        return { result: { empty: true, lines: [] }, contextUpdates };
      }
      const cart = await getCartWithLines({
        store: context.storefrontStore,
        cartId: context.cartId,
      });
      if (!cart) {
        contextUpdates.cartSummary = null;
        return { result: { empty: true }, contextUpdates };
      }
      const summary = toCartSummary(cart);
      contextUpdates.cartSummary = summary;
      contextUpdates.cartAction = {
        checkoutUrl: cart.checkoutUrl,
        totalPrice: cart.totalPrice,
        cartId: context.cartId,
      };
      return { result: summary, contextUpdates };
    }

    case "clear_cart": {
      if (context.cartId) {
        const cart = await getCartWithLines({
          store: context.storefrontStore,
          cartId: context.cartId,
        });
        if (cart?.lines.length) {
          await cartLinesRemove({
            store: context.storefrontStore,
            cartId: context.cartId,
            lineIds: cart.lines.map((line) => line.id),
          });
        }
      }
      contextUpdates.checkoutReady = false;
      contextUpdates.checkoutDraft = createInitialCheckoutDraft();
      contextUpdates.cartSummary = null;
      contextUpdates.lastAddedProduct = null;
      contextUpdates.cartAction = null;
      contextUpdates.lastSearchProducts = [];
      return { result: { cleared: true }, contextUpdates };
    }

    case "remove_cart_item": {
      if (!context.cartId) return { result: { error: "Cart is empty" }, contextUpdates };
      await cartLinesRemove({
        store: context.storefrontStore,
        cartId: context.cartId,
        lineIds: [String(args.lineId ?? "")],
      });
      const summary = await refreshCartSummary(context);
      contextUpdates.cartSummary = summary;
      if (summary) {
        contextUpdates.cartAction = {
          checkoutUrl: summary.checkoutUrl,
          totalPrice: summary.total,
          cartId: context.cartId,
        };
      }
      return {
        result: { removed: true, product: args.productTitle },
        contextUpdates,
      };
    }

    case "save_checkout_info": {
      const field = String(args.field ?? "") as CheckoutField;
      const rawValue = String(args.value ?? "");
      const draft = { ...(context.checkoutDraft ?? createInitialCheckoutDraft()) };

      if (field === "fullName") {
        const nameNorm = await normalizeFullNameInput(rawValue);
        if (!nameNorm.ok) return { result: { saved: false, field, error: nameNorm.reason }, contextUpdates };
        draft.fullName = nameNorm.fullName;
      } else if (field === "email") {
        const emailNorm = normalizeEmailInput(rawValue);
        if (!emailNorm.ok) return { result: { saved: false, field, error: emailNorm.reason }, contextUpdates };
        draft.email = emailNorm.email;
      } else {
        const parsed = parseCheckoutAnswer(field, rawValue);
        if (!parsed.ok) return { result: { saved: false, field, error: parsed.reason }, contextUpdates };
        if (field === "address2") {
          draft.address2 = parsed.value;
        } else {
          draft[field] = parsed.value;
        }
        if (field === "city" && !draft.province) {
          const code = normalizeProvinceCode("", parsed.value);
          const labels: Record<string, string> = {
            PB: "Punjab",
            SD: "Sindh",
            KP: "Khyber Pakhtunkhwa",
            BA: "Balochistan",
            IS: "Islamabad",
            GB: "Gilgit-Baltistan",
            JK: "Azad Kashmir",
          };
          draft.province = labels[code] ?? draft.province;
        }
      }

      contextUpdates.checkoutDraft = draft;
      return { result: { saved: true, field, value: draft[field] }, contextUpdates };
    }

    case "lookup_saved_address": {
      const email = String(args.email ?? "").toLowerCase().trim();
      const profile = await getSavedCustomerProfile({
        storeId: context.storeId,
        identifier: email,
      });
      if (!profile) return { result: { found: false }, contextUpdates };
      return {
        result: {
          found: true,
          summary: buildSavedAddressSummary(profile),
          address: profile,
        },
        contextUpdates,
      };
    }

    case "apply_saved_address": {
      const email = String(args.email ?? "").toLowerCase().trim();
      const profile = await getSavedCustomerProfile({
        storeId: context.storeId,
        identifier: email,
      });
      if (profile) {
        contextUpdates.checkoutDraft = {
          ...(context.checkoutDraft ?? createInitialCheckoutDraft()),
          ...profile,
        };
      }
      return {
        result: { applied: Boolean(profile), address: profile ?? null },
        contextUpdates,
      };
    }

    case "build_checkout_url": {
      const draft = context.checkoutDraft ?? createInitialCheckoutDraft();
      const missing = getMissingFields({
        ...draft,
        country: draft.countryCode ?? "PK",
      });
      if (missing.length > 0) {
        return {
          result: {
            success: false,
            missing,
            message: `Still need: ${missing.join(", ")}`,
          },
          contextUpdates,
        };
      }

      if (!context.cartId) {
        return {
          result: { success: false, message: "Cart is empty or checkout URL unavailable" },
          contextUpdates,
        };
      }

      const cart = await getCartCheckoutUrl({
        store: context.storefrontStore,
        cartId: context.cartId,
      });
      if (!cart?.checkoutUrl) {
        return {
          result: { success: false, message: "Cart is empty or checkout URL unavailable" },
          contextUpdates,
        };
      }

      const prefilled = buildCheckoutUrl(cart.checkoutUrl, {
        fullName: draft.fullName,
        email: draft.email,
        phone: draft.phone,
        address1: draft.address1,
        address2: draft.address2,
        city: draft.city,
        province: draft.province,
        zip: draft.zip,
        country: draft.countryCode ?? "PK",
      });

      contextUpdates.checkoutReady = true;
      contextUpdates.cartAction = {
        checkoutUrl: prefilled,
        totalPrice: cart.totalPrice,
        cartId: context.cartId,
      };

      if (draft.email) {
        try {
          await upsertCustomerProfile({
            storeId: context.storeId,
            identifier: draft.email,
            identifierType: "email",
            draft,
          });
        } catch {
          // non-fatal
        }
      }

      return {
        result: {
          success: true,
          checkoutUrl: prefilled,
          totalPrice: cart.totalPrice,
          message: "Checkout URL ready",
        },
        contextUpdates,
      };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` }, contextUpdates };
  }
}

export function buildProductsAvailableMessage(products: ShopifyProduct[]): string {
  if (products.length === 0) return FALLBACK_REPLY;
  if (products.length === 1) {
    const product = products[0];
    const price = product.price ? `PKR ${product.price}` : "";
    return price
      ? `Found it! ${product.title} — ${price} each. Want me to add it to your cart?`
      : `Found it! ${product.title}. Want me to add it to your cart?`;
  }
  const names = products
    .slice(0, 5)
    .map((product) => product.title)
    .join(", ");
  return `Here are our top picks: ${names}. Which one would you like?`;
}

function finalizeOutput(
  reply: string,
  context: AgentContext,
  toolsUsed: string[]
): AgentLoopOutput {
  const products = context.lastSearchProducts ?? [];
  const resolvedReply =
    reply === FALLBACK_REPLY && products.length > 0
      ? buildProductsAvailableMessage(products)
      : reply;

  return {
    reply: resolvedReply,
    updatedContext: context,
    toolsUsed,
    products,
    checkoutReady: context.checkoutReady ?? false,
    cartAction: context.cartAction ?? null,
  };
}

async function runForcedSearchFallback(
  userMessage: string,
  currentContext: AgentContext,
  messages: GroqChatMessageWithTools[],
  toolsUsed: string[]
): Promise<AgentContext> {
  console.warn("[agent] LLM skipped tools on first turn, forcing search fallback");
  const syntheticId = `fallback_search_${Date.now()}`;
  const toolArgs = { query: userMessage };

  toolsUsed.push("search_products");

  const { result, contextUpdates } = await executeTool(
    "search_products",
    toolArgs,
    currentContext
  );
  const updatedContext = { ...currentContext, ...contextUpdates };
  if (Array.isArray(result.products)) {
    updatedContext.lastSearchProducts = result.products as ShopifyProduct[];
  }

  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: syntheticId,
        type: "function",
        function: {
          name: "search_products",
          arguments: JSON.stringify(toolArgs),
        },
      },
    ],
  });
  messages.push({
    role: "tool",
    tool_call_id: syntheticId,
    content: JSON.stringify(result),
  });

  return updatedContext;
}

export async function runAgentLoop({
  userMessage,
  history,
  context,
  storeName,
  maxIterations = MAX_ITERATIONS,
}: AgentLoopInput): Promise<AgentLoopOutput> {
  const toolsUsed: string[] = [];
  let currentContext: AgentContext = {
    ...context,
    checkoutDraft: context.checkoutDraft ?? createInitialCheckoutDraft(),
    checkoutReady: context.checkoutReady ?? false,
    cartAction: context.cartAction ?? null,
    cartSummary: context.cartSummary ?? null,
    lastSearchProducts: context.lastSearchProducts ?? [],
    lastAddedProduct: context.lastAddedProduct ?? null,
  };

  if (!getGroqKey()) {
    return finalizeOutput(
      "Shop assistant is not fully configured (missing GROQ_API_KEY).",
      currentContext,
      toolsUsed
    );
  }

  console.log("[agent] Groq client: direct HTTP API (groq-sdk not in dependencies)");

  const messages: GroqChatMessageWithTools[] = [
    ...history.slice(-10).map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: userMessage },
  ];

  let emptyContentRetries = 0;
  let forcedSearchFallback = false;

  for (let i = 0; i < maxIterations; i++) {
    const forceTools = i === 0 && toolsUsed.length === 0;
    const systemPrompt = buildSystemPrompt(storeName, currentContext, forceTools);

    const response = await groqChatCompletionWithTools({
      model: GROQ_CHAT_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 500,
    });

    if (!response.ok) {
      console.warn("[agent] Groq API error", { status: response.status, iteration: i });
      if (i === 0 && !forcedSearchFallback) {
        currentContext = await runForcedSearchFallback(
          userMessage,
          currentContext,
          messages,
          toolsUsed
        );
        forcedSearchFallback = true;
        continue;
      }
      return finalizeOutput(FALLBACK_REPLY, currentContext, toolsUsed);
    }

    const { message, finishReason } = response;
    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      if (
        i === 0 &&
        toolsUsed.length === 0 &&
        finishReason === "stop" &&
        !forcedSearchFallback
      ) {
        currentContext = await runForcedSearchFallback(
          userMessage,
          currentContext,
          messages,
          toolsUsed
        );
        forcedSearchFallback = true;
        continue;
      }

      const content = message.content?.trim();
      if (!content) {
        if (emptyContentRetries < 1) {
          emptyContentRetries++;
          continue;
        }
        return finalizeOutput(FALLBACK_REPLY, currentContext, toolsUsed);
      }
      return finalizeOutput(content, currentContext, toolsUsed);
    }

    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      toolsUsed.push(toolName);

      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Invalid tool arguments" }),
        });
        continue;
      }

      try {
        const { result, contextUpdates } = await executeTool(toolName, toolArgs, currentContext);
        currentContext = { ...currentContext, ...contextUpdates };

        if (toolName === "search_products" && Array.isArray(result.products)) {
          currentContext.lastSearchProducts = result.products as ShopifyProduct[];
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      } catch (toolError) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: toolError instanceof Error ? toolError.message : "Tool failed",
          }),
        });
      }
    }

    if (finishReason === "stop" && message.content?.trim()) {
      return finalizeOutput(message.content.trim(), currentContext, toolsUsed);
    }
  }

  return finalizeOutput(FALLBACK_REPLY, currentContext, toolsUsed);
}
