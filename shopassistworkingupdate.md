# ShopAssist — Complete Salesman Rewrite

## Vision

The AI should behave like a **smart, helpful salesman** — not a search engine.

| Old behavior | New behavior |
|---|---|
| "Here are some products, which one?" | "Found it! 2x Wireless Charger = PKR 2398. Add to cart?" |
| Asks before every action | Acts first, confirms naturally |
| Separate turns for search → select → add | One turn: search + pick best + quote price |
| Stage machine with 10+ stages | AI decides the flow |
| User types "the first one" | User just says "sure" or "yes" |
| Cart clear not supported | AI handles any cart operation |
| Repeated/duplicate messages | Clean one message per turn |

---

## The Conversation Model

```
Customer: I want to buy 2 wireless chargers
AI: [searches internally] [finds best match] [calculates price]
    "Found it! Wireless Charger by XBrand — PKR 1199 each.
     2 pieces = PKR 2398 total. Want me to add them to your cart?"

Customer: Sure
AI: [adds to cart] [gets checkout URL]
    "Done! 2x Wireless Charger added 🛒
     Ready to checkout? Just confirm your name and I'll guide you through."

Customer: Ali Khan
AI: [saves name] "Got it Ali! What's your email address?"

Customer: ali@gmail.com
AI: [saves email] [checks saved profile — found!]
    "I have your saved address: House 5, Block A, Lahore. Use this?"

Customer: Yes
AI: [applies saved address to cart]
    "Perfect! Your order is ready. Here's your checkout link → [Complete Order]"
```

**Every action happens inside the AI turn. Customer only confirms or provides info.**

---

## Architecture — Complete Rewrite

### What Gets Deleted
```
src/lib/shopify/intent-parser.ts         DELETE
src/lib/shopify/query-recovery.ts        DELETE
src/lib/shopify/product-selection.ts     DELETE
src/lib/shopify/checkout-collector.ts    DELETE (replace with simple validator)
src/lib/shopify/gpt-agent.ts             DELETE (full rewrite)
src/app/api/v1/shopify/chat/route.ts     DELETE (full rewrite)
src/lib/shopify/types.ts                 SIMPLIFY
```

### What Stays
```
src/lib/shopify/storefront.ts            KEEP — tool implementations
src/lib/shopify/session.ts              KEEP — minor cleanup
src/lib/shopify/customer-profile.ts     KEEP
src/lib/shopify/admin.ts                KEEP
src/lib/shopify/oauth.ts                KEEP
src/lib/shopify/whisper.ts              KEEP
src/lib/shopify/tts.ts                  KEEP
src/lib/shopify/encrypt.ts              KEEP
src/lib/shopify/email-normalizer.ts     KEEP
src/lib/shopify/name-normalizer.ts      KEEP
public/widget.js                        PARTIAL REWRITE (rendering fixes)
```

---

## New File: `src/lib/shopify/gpt-agent.ts`

Complete rewrite. This is now the entire brain.

```typescript
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";
const MAX_ITERATIONS = 6;

// ─── TOOL DEFINITIONS ───────────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: `Search the store catalog. Call this whenever the customer 
      mentions any product, category, or item they want. Also call this to 
      browse alternatives when no results found.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms e.g. 'wireless charger', 'blue running shoes'" },
          sort: {
            type: "string",
            enum: ["RELEVANCE", "PRICE_ASC", "PRICE_DESC", "BEST_SELLING", "CREATED_AT_DESC"],
            description: "PRICE_ASC=cheapest first, BEST_SELLING=popular, CREATED_AT_DESC=newest"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: `Add a product to cart. Call this after customer confirms 
      they want a product OR when they say 'sure', 'yes', 'add it', 'okay'.
      Pick the best matching variant automatically. If multiple very different 
      variants exist (like S/M/L/XL) and customer hasn't specified, ask first.`,
      parameters: {
        type: "object",
        properties: {
          variantId: { type: "string", description: "Shopify variant GID" },
          quantity: { type: "number", description: "How many to add. Default 1." },
          productTitle: { type: "string", description: "Product name for confirmation" },
          price: { type: "string", description: "Unit price for display" }
        },
        required: ["variantId", "quantity", "productTitle", "price"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cart",
      description: "Get current cart contents and total. Call when customer asks about cart or before starting checkout.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "clear_cart",
      description: "Remove ALL items from cart. Call when customer says 'clear cart', 'empty cart', 'delete everything', 'start over', 'remove all'.",
      parameters: { type: "object", properties: {}, required: [] }
    }
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
          productTitle: { type: "string", description: "Product name for confirmation" }
        },
        required: ["lineId", "productTitle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_checkout_info",
      description: `Save checkout details the customer provides. Call this as soon 
      as the customer gives any piece of info (name, email, phone, address etc).
      Call once per field, immediately when the customer provides it.`,
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["fullName", "email", "phone", "address1", "address2", "city", "province", "zip"],
          },
          value: { type: "string" }
        },
        required: ["field", "value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_saved_address",
      description: "Check if customer has a saved delivery address. Call this after saving their email.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_saved_address",
      description: "Apply the customer's previously saved address to the cart. Call when customer says yes to using saved address.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "complete_checkout",
      description: `Apply all collected delivery details to the cart and generate 
      checkout URL. Call this ONLY when you have ALL required fields: 
      fullName, email, phone, address1, city, province, zip.`,
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

function buildSystemPrompt(storeName: string, context: AgentContext): string {
  const cartInfo = context.cartSummary
    ? `Cart: ${context.cartSummary.itemCount} items, Total: PKR ${context.cartSummary.total}`
    : "Cart: Empty";

  const checkoutProgress = context.checkoutDraft
    ? Object.entries(context.checkoutDraft)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
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

## HOW TO HANDLE CHECKOUT
- When cart has items and customer wants to checkout → collect info conversationally
- Ask ONE field at a time, naturally: "What's your name?" not a list
- After email → call lookup_saved_address immediately
- If saved address found → offer it ("I have your address on file: X. Use this?")
- If yes → call apply_saved_address → skip remaining address fields → complete_checkout
- Required fields before calling complete_checkout: fullName, email, phone, address1, city, province, zip
- Pakistan is the default country. Map cities to provinces: Lahore→Punjab, Karachi→Sindh, 
  Islamabad→Islamabad Capital Territory, Peshawar→KPK, Quetta→Balochistan

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
${cartInfo}
Checkout info collected: ${checkoutProgress}
Checkout ready: ${context.checkoutReady ? "YES — share checkout link" : "No"}
`;
}

// ─── TOOL EXECUTOR ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: any,
  context: AgentContext
): Promise<{ result: any; contextUpdates: Partial<AgentContext> }> {
  
  const contextUpdates: Partial<AgentContext> = {};

  switch (name) {
    case "search_products": {
      const products = await searchProducts(context.storefrontStore, {
        query: args.query,
        sortKey: args.sort ?? "RELEVANCE",
        first: 5,
      });
      return { result: { products, count: products.length }, contextUpdates };
    }

    case "add_to_cart": {
      const cart = await addToCart(
        context.storefrontStore,
        context.cartId,
        args.variantId,
        args.quantity
      );
      contextUpdates.cartId = cart.cartId;
      contextUpdates.lastAddedProduct = {
        title: args.productTitle,
        price: args.price,
        quantity: args.quantity,
      };
      return { result: { success: true, cartId: cart.cartId, checkoutUrl: cart.checkoutUrl }, contextUpdates };
    }

    case "get_cart": {
      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      contextUpdates.cartSummary = cart;
      return { result: cart, contextUpdates };
    }

    case "clear_cart": {
      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      if (cart?.lines?.length > 0) {
        const lineIds = cart.lines.map((l: any) => l.id);
        await cartLinesRemove(context.storefrontStore, context.cartId, lineIds);
      }
      contextUpdates.checkoutReady = false;
      contextUpdates.checkoutDraft = {};
      contextUpdates.cartSummary = null;
      contextUpdates.lastAddedProduct = null;
      return { result: { cleared: true }, contextUpdates };
    }

    case "remove_cart_item": {
      await cartLinesRemove(context.storefrontStore, context.cartId, [args.lineId]);
      return { result: { removed: true, product: args.productTitle }, contextUpdates };
    }

    case "save_checkout_info": {
      const draft = { ...(context.checkoutDraft ?? {}), [args.field]: args.value };
      contextUpdates.checkoutDraft = draft;
      return { result: { saved: true, field: args.field, value: args.value }, contextUpdates };
    }

    case "lookup_saved_address": {
      const profile = await findSavedProfile(args.email, context.storeId);
      return { result: profile ?? { found: false }, contextUpdates };
    }

    case "apply_saved_address": {
      const profile = await findSavedProfile(args.email, context.storeId);
      if (profile) {
        contextUpdates.checkoutDraft = { ...(context.checkoutDraft ?? {}), ...profile.address };
      }
      return { result: { applied: true, address: profile?.address }, contextUpdates };
    }

    case "complete_checkout": {
      const result = await applyCheckoutDetailsToCart(
        context.storefrontStore,
        context.cartId,
        context.checkoutDraft
      );
      contextUpdates.checkoutReady = true;
      contextUpdates.cartAction = {
        checkoutUrl: result.checkoutUrl,
        totalPrice: result.totalPrice,
      };
      return { result, contextUpdates };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` }, contextUpdates };
  }
}

// ─── MAIN AGENT LOOP ─────────────────────────────────────────────────────────

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopOutput> {
  const { userMessage, history, context, storeName } = input;

  // Build messages array for Groq
  const messages: any[] = [
    ...history.slice(-10), // last 10 turns for context
    { role: "user", content: userMessage }
  ];

  const systemPrompt = buildSystemPrompt(storeName, context);
  let currentContext = { ...context };
  const toolsUsed: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: TOOLS,
      // Force tool use on first iteration if message seems actionable
      tool_choice: i === 0 ? "required" : "auto",
      max_tokens: 500,
      temperature: 0.3, // lower = more consistent behavior
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // Agent chose to reply with text — we're done
    if (choice.finish_reason === "stop" && assistantMessage.content) {
      return {
        reply: assistantMessage.content,
        updatedContext: currentContext,
        toolsUsed,
        products: currentContext.lastSearchProducts ?? [],
        checkoutReady: currentContext.checkoutReady ?? false,
        cartAction: currentContext.cartAction ?? null,
      };
    }

    // Agent wants to call tools
    if (choice.finish_reason === "tool_calls" && assistantMessage.tool_calls) {
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        toolsUsed.push(toolName);

        const { result, contextUpdates } = await executeTool(toolName, toolArgs, currentContext);
        
        // Update context with any changes the tool made
        currentContext = { ...currentContext, ...contextUpdates };

        // If search returned products, store them for widget rendering
        if (toolName === "search_products" && result.products) {
          currentContext.lastSearchProducts = result.products;
        }

        // Append tool result for agent to process
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      // Continue loop — agent will now process results and reply
      continue;
    }

    // Empty response — retry once with auto
    if (!assistantMessage.content?.trim()) {
      console.warn(`[agent] Empty response on iteration ${i}, retrying`);
      continue;
    }
  }

  // Max iterations hit — give a safe fallback
  return {
    reply: "Sorry, I couldn't complete that. Please try again.",
    updatedContext: currentContext,
    toolsUsed,
    products: [],
    checkoutReady: false,
    cartAction: null,
  };
}
```

---

## New File: `src/app/api/v1/shopify/chat/route.ts`

Thin orchestrator — all logic is in the agent now.

```typescript
import { NextRequest } from "next/server";
import { runAgentLoop } from "@/lib/shopify/gpt-agent";
import { getActiveStoreByDomain } from "@/lib/shopify/storefront";
import { getOrCreateSession, saveSessionState } from "@/lib/shopify/session";
import { assertQuotaOk } from "@/lib/usage/quota";
import { logUsage } from "@/lib/shopify/usage-logger";
import { buildStorefrontStore } from "@/lib/shopify/storefront";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let phase = "init";

  try {
    // ── Validate ──────────────────────────────────────────────────────────
    phase = "validate";
    const shopDomain = req.headers.get("X-Shop-Domain");
    if (!shopDomain) {
      return Response.json({ success: false, error: "Missing X-Shop-Domain" }, { status: 400 });
    }

    const body = await req.json();
    const { message, sessionToken } = body;

    if (!message || message.length < 1 || message.length > 2000) {
      return Response.json({ success: false, error: "Invalid message" }, { status: 400 });
    }
    if (!sessionToken || sessionToken.length < 8) {
      return Response.json({ success: false, error: "Invalid session token" }, { status: 400 });
    }

    // ── Load store ────────────────────────────────────────────────────────
    phase = "store";
    const store = await getActiveStoreByDomain(shopDomain);
    if (!store) {
      return Response.json({ success: false, error: "Store not found" }, { status: 404 });
    }
    if (store.authStatus === "REAUTH_REQUIRED") {
      return Response.json({ success: false, error: "Store needs reconnection" }, { status: 401 });
    }

    // ── Quota check ───────────────────────────────────────────────────────
    phase = "quota";
    await assertQuotaOk(store.projectId);

    // ── Load session ──────────────────────────────────────────────────────
    phase = "session";
    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const session = await getOrCreateSession(store.id, sessionToken, ip);
    const history = session.messages ?? [];
    const savedContext = session.sessionContext ?? {};

    // ── Build agent context ───────────────────────────────────────────────
    phase = "agent";
    const agentContext = {
      cartId: savedContext.cartId ?? null,
      checkoutDraft: savedContext.checkoutDraft ?? {},
      checkoutReady: savedContext.checkoutReady ?? false,
      cartAction: savedContext.cartAction ?? null,
      cartSummary: savedContext.cartSummary ?? null,
      lastSearchProducts: [],
      lastAddedProduct: savedContext.lastAddedProduct ?? null,
      storefrontStore: buildStorefrontStore(store),
      storeId: store.id,
    };

    // ── Run agent ─────────────────────────────────────────────────────────
    const result = await runAgentLoop({
      userMessage: message,
      history,
      context: agentContext,
      storeName: store.shopName ?? shopDomain,
    });

    console.log("[shopify/chat] agent reply", {
      requestId,
      phase: "done",
      toolsUsed: result.toolsUsed,
      checkoutReady: result.checkoutReady,
      productCount: result.products?.length ?? 0,
      messagePreview: result.reply?.slice(0, 80),
    });

    // ── Save session ──────────────────────────────────────────────────────
    phase = "save";
    const updatedMessages = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: result.reply },
    ].slice(-20); // keep last 20 messages only

    // Save session but don't let DB failure crash the response
    saveSessionState(session.id, updatedMessages, result.updatedContext).catch((err) => {
      console.error("[shopify/chat] Session save failed (non-fatal):", err);
    });

    // ── Log usage ─────────────────────────────────────────────────────────
    logUsage(store.projectId, "chat").catch(() => {});

    // ── Return ────────────────────────────────────────────────────────────
    return Response.json({
      success: true,
      data: {
        message: result.reply,
        products: result.products ?? [],
        cartAction: result.cartAction,
        checkoutReady: result.checkoutReady,
        redirectToCheckout: false, // widget shows button, doesn't auto-redirect
        sessionToken,
      }
    });

  } catch (error: any) {
    console.error("[shopify/chat] Error", { requestId, phase, error: error?.message });

    if (error?.message?.includes("quota")) {
      return Response.json(
        { success: false, error: "quota_exceeded", data: { message: "Monthly limit reached. Please upgrade your plan.", products: [] } },
        { status: 429 }
      );
    }

    return Response.json(
      { success: false, error: "internal_error", data: { message: "Something went wrong. Please try again.", products: [] } },
      { status: 500 }
    );
  }
}
```

---

## Simplified `SessionContext` Type

```typescript
// src/lib/shopify/types.ts

export interface AgentContext {
  cartId: string | null;
  checkoutDraft: CheckoutDraft;
  checkoutReady: boolean;
  cartAction: CartAction | null;
  cartSummary: CartSummary | null;
  lastSearchProducts: ShopifyProduct[];
  lastAddedProduct: { title: string; price: string; quantity: number } | null;
  storefrontStore: StorefrontStore;   // runtime only, not persisted
  storeId: string;                    // runtime only, not persisted
}

export interface CheckoutDraft {
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
}

export interface CartAction {
  checkoutUrl: string;
  totalPrice: string;
  cartId?: string;
}

// DELETE: ConversationStage
// DELETE: selectedProduct
// DELETE: lastProducts
// DELETE: checkoutField
// DELETE: resultMode
```

---

## Widget Fixes (`public/widget.js`)

These rendering bugs must be fixed alongside the backend rewrite:

### Fix 1 — No duplicate sends
```javascript
let isSending = false;

async function sendMessage(text) {
  if (isSending || !text.trim()) return;
  isSending = true;
  sendBtn.disabled = true;
  inputField.disabled = true;

  try {
    appendMessage("user", text);
    inputField.value = "";
    const data = await callChatAPI(text);
    handleResponse(data);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    inputField.disabled = false;
    inputField.focus();
  }
}

// Attach ONCE — not on both keydown and click separately
sendBtn.addEventListener("click", () => sendMessage(inputField.value));
inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputField.value);
  }
});
```

### Fix 2 — Clean response rendering
```javascript
function handleResponse(response) {
  // On error: show message only, no product cards
  if (!response.success) {
    appendMessage("assistant", response.data?.message ?? "Something went wrong.");
    return;
  }

  const data = response.data;

  // Clear previous product cards before showing new ones
  clearProductCards();

  // Show assistant message
  if (data.message) {
    appendMessage("assistant", data.message);
  }

  // Show product cards only if products exist
  if (data.products?.length > 0) {
    renderProductCards(data.products);
  }

  // Show checkout button only if ready AND URL exists
  if (data.checkoutReady && data.cartAction?.checkoutUrl) {
    showCheckoutButton(data.cartAction.checkoutUrl, data.cartAction.totalPrice);
  } else {
    hideCheckoutButton();
  }
}

function clearProductCards() {
  const existing = chatContainer.querySelectorAll(".product-cards-row");
  existing.forEach(el => el.remove());
}

function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  div.textContent = text;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
```

### Fix 3 — Deduplicate messages
```javascript
function appendMessage(role, text) {
  // Deduplicate — don't add if last message is identical
  const last = chatContainer.querySelector(".message:last-child");
  if (last?.textContent === text && last?.classList.contains(`${role}-message`)) return;

  const div = document.createElement("div");
  div.className = `message ${role}-message`;
  div.textContent = text;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
```

---

## Conversation Flow Examples

### Flow 1 — Buy with quantity (1 turn to cart)
```
User:  "I want to buy 2 wireless chargers"
Agent: search_products("wireless charger")
       → finds Wireless Charger PKR 1199
Agent: "Found it! Wireless Charger — PKR 1199 each.
        2 pieces = PKR 2,398 total. Want me to add them to your cart?"
User:  "Yes"
Agent: add_to_cart(variantId, qty=2)
       → success
Agent: "Done! 2x Wireless Charger added to your cart 🛒
        Want to checkout? Just tell me your name."
```

### Flow 2 — Returning customer (fast checkout)
```
User:  "Checkout"
Agent: get_cart() → 1 item PKR 1199
Agent: "You have 1 item (PKR 1,199). What's your name?"
User:  "Ali Khan"
Agent: save_checkout_info(fullName, "Ali Khan")
Agent: "What's your email?"
User:  "ali@gmail.com"
Agent: save_checkout_info(email, "ali@gmail.com")
       lookup_saved_address("ali@gmail.com") → found!
Agent: "I have your saved address: House 5, Block A, Lahore. Use it?"
User:  "Yes"
Agent: apply_saved_address("ali@gmail.com")
       save_checkout_info(phone, saved)
       complete_checkout()
Agent: "Perfect! Your order is ready. Tap Complete Order below ✓"
       [Complete Order button appears in widget]
```

### Flow 3 — Cart management
```
User:  "Clear my cart"
Agent: clear_cart()
Agent: "Done! Your cart is now empty. Looking for something specific?"

User:  "Show me something popular"
Agent: search_products("", sort=BEST_SELLING)
Agent: "Here are our top picks:" [product cards render]
```

### Flow 4 — Browse vs buy intent
```
User:  "Show me phone cases"       → search only, show results, wait
User:  "I want to buy a phone case" → search, pick best, quote price, ask to add
User:  "Buy the cheapest one"      → search(PRICE_ASC), add first result, confirm
```

---

## Cursor Implementation Checklist

### Phase 1 — Core agent
- [ ] Delete `intent-parser.ts`, `query-recovery.ts`, `product-selection.ts`, `checkout-collector.ts`
- [ ] Create new `gpt-agent.ts` with the full agent loop above
- [ ] Create new `chat/route.ts` as the thin orchestrator above
- [ ] Update `types.ts` — simplify to `AgentContext`, `CheckoutDraft`, `CartAction`
- [ ] Add `cartLinesRemove()` to `storefront.ts` if not already there
- [ ] Verify `getCartWithLines()` exists in `storefront.ts`

### Phase 2 — Widget fixes
- [ ] Fix double-send with `isSending` lock in `widget.js`
- [ ] Fix `handleResponse()` to guard against error+products split-brain
- [ ] Fix `appendMessage()` with deduplication
- [ ] Add `clearProductCards()` before each new response
- [ ] Fix checkout button to only show when `checkoutReady && checkoutUrl` both exist
- [ ] Ensure user messages render RIGHT-aligned, assistant LEFT-aligned

### Phase 3 — Session cleanup
- [ ] In `session.ts`, ensure `getOrCreateSession` does NOT write messages
- [ ] Ensure `saveSessionState` is called ONCE at end of route, never at start
- [ ] Strip `ConversationStage`, `checkoutField`, `selectedProduct`, `lastProducts` from session context

### Phase 4 — Test these exact flows
- [ ] "I want to buy 2 wireless chargers" → adds 2 to cart in one go
- [ ] "Sure" after product shown → adds to cart
- [ ] "Clear my cart" → clears cart, no product search triggered
- [ ] "Checkout" → collects fields one by one conversationally
- [ ] Returning email → saved address offered and applied
- [ ] Urdu/Roman Urdu message → handled naturally
- [ ] 500 error → clean error message, no product cards shown
- [ ] Double tap send → only one message sent