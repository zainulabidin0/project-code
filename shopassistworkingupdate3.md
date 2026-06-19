# ShopAssist — Phase 3: Hybrid Architecture (Smart Code + Lean AI)

## The Problem With Both Previous Approaches

| Original (Rules-first) | Phase 1/2 (Pure Agentic) |
|---|---|
| Felt robotic — user had to say "the first one" | Feels smart but slow & expensive |
| 1-2 LLM calls per turn | Up to 6 LLM calls per turn |
| Cheap and fast | History + 9 tools sent every call = token-heavy |
| Couldn't chain actions (search+add in one turn) | Can chain actions, but loop is wasteful |
| Easy to debug (deterministic) | Hard to debug (LLM decides everything) |

## The Fix: Hybrid Architecture

**Code does the deterministic, fast, cheap work. The LLM only does the one thing LLMs are actually good at: understanding language and deciding intent + extracting structured info — in a SINGLE call, not a loop.**

```
User message
    │
    ▼
┌──────────────────────────────────────────────────┐
│  SINGLE LLM CALL — "Planner"                      │
│  Model: llama-3.3-70b-versatile                   │
│  One call, structured JSON output, no tool loop    │
│                                                    │
│  Input: message + last 6 turns + compact state    │
│  Output: a PLAN — a list of actions to execute     │
│                                                    │
│  {                                                │
│    "actions": [                                  │
│      { "type": "search", "query": "wireless charger" },│
│      { "type": "add_to_cart", "quantity": 2 }     │
│    ],                                             │
│    "reply_style": "confirm_and_quote_price",      │
│    "missing_info": null                           │
│  }                                                │
└──────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────┐
│  CODE EXECUTOR (deterministic, no LLM)            │
│  File: action-executor.ts                         │
│                                                    │
│  - Runs each action in the plan, in order          │
│  - Calls real Shopify APIs                         │
│  - Picks "best match" using a scoring function      │
│    (not LLM guessing) — exact match > partial      │
│    match > price > rating                          │
│  - Validates checkout fields with regex/library     │
│  - Builds the prefilled checkout URL                │
│  - Produces a RESULT object                         │
└──────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────┐
│  TEMPLATE-DRIVEN REPLY (mostly code, light LLM)    │
│  File: reply-composer.ts                          │
│                                                    │
│  - 90% of replies use TEMPLATES (instant, free,    │
│    consistent) — e.g. "Found it! {title} —          │
│    {price} each. {qty}x = {total}. Add to cart?"   │
│  - Only call a SECOND lightweight LLM pass when     │
│    the situation is genuinely novel/ambiguous       │
│    (rare — maybe 10% of turns)                      │
└──────────────────┬─────────────────────────────────┘
                    │
                    ▼
            Final reply to widget
```

**Result: 1 LLM call for 90% of turns. 2 LLM calls (small) for the rare ambiguous ones. Never a loop.**

---

## Why This Still "Feels Like AI"

The user experience is **identical** to the pure-agentic version:

```
User:  "I want to buy 2 wireless chargers"
AI:    "Found it! Wireless Charger — PKR 1199 each. 
        2 pieces = PKR 2,398. Want me to add them to your cart?"
User:  "Sure"
AI:    "Done! 2x Wireless Charger added 🛒 Ready to checkout?"
```

But under the hood:
- The LLM made **ONE call** to understand "buy 2 wireless chargers" → produced a plan
- Code executed the search, code picked the best match, code calculated the total
- The reply was assembled from a **template**, not generated word-by-word by the LLM
- No tool-calling loop, no 6 iterations, no redundant token spend

---

## File Structure

```
src/lib/shopify/
  planner.ts              ← NEW: single LLM call, returns structured plan
  action-executor.ts       ← NEW: deterministic action runner
  product-matcher.ts        ← NEW: scoring-based "best match" picker (no LLM)
  reply-composer.ts         ← NEW: template-driven replies + rare LLM fallback
  checkout-url-builder.ts   ← KEEP from Phase 2
  storefront.ts             ← KEEP (Shopify API calls)
  session.ts                ← KEEP
  customer-profile.ts       ← KEEP
  types.ts                  ← UPDATE

src/app/api/v1/shopify/chat/route.ts   ← REWRITE (orchestrates planner → executor → composer)

DELETE:
  gpt-agent.ts (old tool-loop version)
  intent-parser.ts (if still present)
```

---

## Step 1 — The Planner (Single LLM Call)

**File:** `src/lib/shopify/planner.ts`

This is the **only** LLM call for most turns. It returns structured JSON — not prose, not tool calls in a loop. One request, one response.

```typescript
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface PlanAction {
  type: "search" | "add_to_cart" | "remove_from_cart" | "clear_cart" 
      | "get_cart" | "save_checkout_field" | "build_checkout_url" | "none";
  // search
  query?: string;
  sort?: "RELEVANCE" | "PRICE_ASC" | "PRICE_DESC" | "BEST_SELLING" | "CREATED_AT_DESC";
  // add_to_cart
  quantity?: number;
  productRef?: "last_searched" | "specific_index" | "cart_item";
  productIndex?: number;
  // save_checkout_field
  field?: "fullName" | "email" | "phone" | "address1" | "address2" | "city" | "zip";
  value?: string;
}

export interface Plan {
  actions: PlanAction[];
  userIntent: "browse" | "buy" | "cart_management" | "checkout" | "chitchat" | "off_topic";
  replyTemplate: 
    | "search_results"           // show products, ask which
    | "single_match_confirm"     // "Found it! quote price, ask to add"
    | "added_confirmation"       // "Done! X added to cart"
    | "cart_summary"             // show cart contents
    | "cart_cleared"             // "Cart emptied"
    | "ask_checkout_field"       // "What's your X?"
    | "checkout_url_ready"       // "All set! Tap below"
    | "saved_address_offer"      // "I have your address: X. Use it?"
    | "no_results"               // "Couldn't find that"
    | "needs_clarification"      // ambiguous, need LLM fallback
    | "off_topic_redirect"
    | "chitchat_reply";
  clarificationNeeded?: string;  // what's ambiguous, if replyTemplate is needs_clarification
  language: "en" | "ur" | "roman_ur";  // detected language for reply
}

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
  (code will pick best match and decide whether to also add_to_cart based on confidence)

- "buy 2 X" → same as above but note quantity
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

- "checkout" / "let's go" / "place order" / "pay now" / checkout-related Urdu phrases →
  userIntent: "checkout"
  If cart empty: replyTemplate: "no_results" with note cart is empty
  If checkout fields incomplete: actions: [] , replyTemplate: "ask_checkout_field"
  (code determines which field is next based on draft state)

- When user provides info during checkout (name/email/phone/address/city/zip):
  actions: [{ type: "save_checkout_field", field: "...", value: "..." }]
  replyTemplate: "ask_checkout_field" (for next field) OR "saved_address_offer" 
  (if field was email and this needs a lookup) OR "checkout_url_ready" (if this was the last field)

- Greetings / thanks / small talk → 
  userIntent: "chitchat"
  actions: []
  replyTemplate: "chitchat_reply"

- Unrelated to shopping →
  userIntent: "off_topic"
  actions: []
  replyTemplate: "off_topic_redirect"

- If the message is genuinely ambiguous (e.g. "the second one" but no products 
  were shown, or unclear which cart item to remove) →
  replyTemplate: "needs_clarification"
  clarificationNeeded: "<describe what's unclear>"

## LANGUAGE DETECTION
Detect if the message is English, Urdu (Arabic script), or Roman Urdu (Urdu written 
in Latin letters, e.g. "mujhe yeh chahiye"). Set the language field accordingly.

## OUTPUT FORMAT
Respond with ONLY valid JSON matching the Plan interface. No markdown, no explanation.`;

export async function generatePlan(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  stateSnapshot: string  // compact summary, see buildStateSnapshot()
): Promise<Plan> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `## Conversation history (last 6 turns)\n${formatHistory(history)}\n\n## Current state\n${stateSnapshot}\n\n## User message\n"${userMessage}"\n\nOutput the JSON plan now.` }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,  // low temp = consistent planning
    max_tokens: 400,    // plans are short — no need for big budget
  });

  const raw = response.choices[0].message.content;
  try {
    return JSON.parse(raw!) as Plan;
  } catch (err) {
    console.error("[planner] Failed to parse plan JSON:", raw);
    // Safe fallback plan
    return {
      actions: [{ type: "search", query: userMessage }],
      userIntent: "browse",
      replyTemplate: "search_results",
      language: "en",
    };
  }
}

function formatHistory(history: Array<{ role: string; content: string }>): string {
  return history.slice(-6).map(h => `${h.role}: ${h.content}`).join("\n");
}
```

**Token cost of this call: ~800-1200 tokens total. ONE call. Done.**

---

## Step 2 — Product Matcher (No LLM — Pure Code)

**File:** `src/lib/shopify/product-matcher.ts`

This replaces "let the LLM guess the best product" with a **deterministic scoring algorithm**. Fast, free, predictable, debuggable.

```typescript
export interface ScoredProduct {
  product: ShopifyProduct;
  score: number;
}

/**
 * Score products against the search query to find the best match.
 * Higher score = better match. Used when buy-intent needs auto-selection.
 */
export function rankProducts(products: ShopifyProduct[], query: string): ScoredProduct[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = products.map(product => {
    const title = product.title.toLowerCase();
    let score = 0;

    // Exact title match (highest signal)
    if (title === query.toLowerCase()) score += 100;

    // All query words present in title
    const matchedWords = queryWords.filter(w => title.includes(w));
    score += (matchedWords.length / queryWords.length) * 50;

    // Word order/proximity bonus (title starts with query)
    if (title.startsWith(query.toLowerCase())) score += 20;

    // Availability bonus
    if (product.availableForSale) score += 10;

    // Popularity/best-seller bonus if data available
    if (product.tags?.includes("bestseller")) score += 5;

    return { product, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Decide if we're confident enough to auto-select without asking the user.
 * Returns true if top match is clearly better than the rest.
 */
export function isConfidentMatch(ranked: ScoredProduct[]): boolean {
  if (ranked.length === 0) return false;
  if (ranked.length === 1) return true;

  const [top, second] = ranked;
  // Confident if top score is significantly higher than runner-up
  return top.score >= 50 && (top.score - second.score) >= 20;
}

/**
 * Pick the best variant of a product automatically when possible.
 * Returns null if multiple meaningfully different variants exist 
 * (e.g. sizes) and we should ask instead.
 */
export function pickVariant(product: ShopifyProduct): { variant: ProductVariant; needsClarification: boolean } {
  const variants = product.variants ?? [];
  
  if (variants.length === 1) {
    return { variant: variants[0], needsClarification: false };
  }

  // If variants only differ by something irrelevant (e.g. all same except SKU), 
  // pick the first available one
  const distinguishingOptions = product.options?.filter(
    opt => !["title", "default"].includes(opt.name.toLowerCase())
  ) ?? [];

  if (distinguishingOptions.length === 0) {
    const firstAvailable = variants.find(v => v.availableForSale) ?? variants[0];
    return { variant: firstAvailable, needsClarification: false };
  }

  // Real variant choice exists (size, color) — ask the user
  return { variant: variants[0], needsClarification: true };
}
```

---

## Step 3 — Action Executor (Deterministic, No LLM)

**File:** `src/lib/shopify/action-executor.ts`

```typescript
import { searchProducts, addToCart, getCartWithLines, cartLinesRemove } from "./storefront";
import { rankProducts, isConfidentMatch, pickVariant } from "./product-matcher";
import { findSavedProfile } from "./customer-profile";
import { buildCheckoutUrl, getMissingFields, FIELD_PROMPTS } from "./checkout-url-builder";
import { validateEmail } from "./email-normalizer";
import type { Plan, PlanAction } from "./planner";
import type { AgentContext } from "./types";

export interface ExecutionResult {
  replyData: Record<string, any>;   // data for the template
  contextUpdates: Partial<AgentContext>;
  products?: ShopifyProduct[];
}

export async function executePlan(plan: Plan, context: AgentContext): Promise<ExecutionResult> {
  let result: ExecutionResult = { replyData: {}, contextUpdates: {} };

  for (const action of plan.actions) {
    const actionResult = await executeAction(action, context, plan);
    result = mergeResults(result, actionResult);
    context = { ...context, ...actionResult.contextUpdates }; // carry forward for next action
  }

  // Special handling for checkout flow — code decides next field, not LLM
  if (plan.userIntent === "checkout" && plan.replyTemplate === "ask_checkout_field") {
    const checkoutResult = handleCheckoutProgress(context);
    result = mergeResults(result, checkoutResult);
  }

  return result;
}

async function executeAction(
  action: PlanAction, 
  context: AgentContext,
  plan: Plan
): Promise<ExecutionResult> {

  switch (action.type) {
    case "search": {
      const products = await searchProducts(context.storefrontStore, {
        query: action.query!,
        sortKey: action.sort ?? "RELEVANCE",
        first: 5,
      });

      if (products.length === 0) {
        return { replyData: { found: false, query: action.query }, contextUpdates: {} };
      }

      // BUY INTENT: try to auto-select with confidence scoring
      if (plan.userIntent === "buy") {
        const ranked = rankProducts(products, action.query!);
        if (isConfidentMatch(ranked)) {
          const best = ranked[0].product;
          const { variant, needsClarification } = pickVariant(best);

          if (needsClarification) {
            return {
              replyData: { 
                needsVariantChoice: true, 
                product: best, 
                variants: best.variants 
              },
              contextUpdates: { lastSearchProducts: [best] },
            };
          }

          const quantity = action.quantity ?? 1;
          return {
            replyData: {
              singleMatch: true,
              product: best,
              variant,
              quantity,
              unitPrice: variant.price,
              totalPrice: (parseFloat(variant.price) * quantity).toFixed(2),
            },
            contextUpdates: { 
              lastSearchProducts: [best],
              pendingAdd: { variantId: variant.id, quantity, title: best.title, price: variant.price }
            },
          };
        }
      }

      // BROWSE INTENT or low-confidence buy: show results, let user pick
      return {
        replyData: { found: true, products, query: action.query },
        contextUpdates: { lastSearchProducts: products },
        products,
      };
    }

    case "add_to_cart": {
      // Use pending add from previous turn's search, or context's last searched product
      const pending = context.pendingAdd;
      if (!pending) {
        return { 
          replyData: { error: "no_pending_product" }, 
          contextUpdates: {} 
        };
      }

      const cartResult = await addToCart(
        context.storefrontStore,
        context.cartId,
        pending.variantId,
        action.quantity ?? pending.quantity
      );

      return {
        replyData: {
          added: true,
          title: pending.title,
          quantity: action.quantity ?? pending.quantity,
          price: pending.price,
        },
        contextUpdates: { 
          cartId: cartResult.cartId,
          pendingAdd: null,
        },
      };
    }

    case "get_cart": {
      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      return {
        replyData: { cart },
        contextUpdates: { cartSummary: cart },
      };
    }

    case "clear_cart": {
      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      if (cart?.lines?.length > 0) {
        await cartLinesRemove(context.storefrontStore, context.cartId, cart.lines.map((l: any) => l.id));
      }
      return {
        replyData: { cleared: true },
        contextUpdates: { 
          checkoutReady: false, 
          checkoutDraft: {}, 
          cartSummary: null,
          pendingAdd: null,
        },
      };
    }

    case "remove_from_cart": {
      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      const targetLine = cart?.lines?.[0]; // refine matching logic as needed
      if (targetLine) {
        await cartLinesRemove(context.storefrontStore, context.cartId, [targetLine.id]);
      }
      return {
        replyData: { removed: true, title: targetLine?.title },
        contextUpdates: {},
      };
    }

    case "save_checkout_field": {
      const draft = { ...(context.checkoutDraft ?? {}), [action.field!]: action.value };

      // Validate specific fields with code (not LLM)
      if (action.field === "email" && !validateEmail(action.value!)) {
        return { 
          replyData: { invalidField: "email", value: action.value }, 
          contextUpdates: {} 
        };
      }

      const updates: Partial<AgentContext> = { checkoutDraft: draft };

      // Auto-lookup saved profile right after email is saved
      if (action.field === "email") {
        const profile = await findSavedProfile(action.value!, context.storeId);
        if (profile) {
          return {
            replyData: { savedProfileFound: true, profile },
            contextUpdates: updates,
          };
        }
      }

      return { replyData: { fieldSaved: action.field }, contextUpdates: updates };
    }

    case "build_checkout_url": {
      const missing = getMissingFields(context.checkoutDraft);
      if (missing.length > 0) {
        return { 
          replyData: { missingFields: missing }, 
          contextUpdates: {} 
        };
      }

      const cart = await getCartWithLines(context.storefrontStore, context.cartId);
      const url = buildCheckoutUrl(cart.checkoutUrl, context.checkoutDraft);

      return {
        replyData: { checkoutUrl: url, totalPrice: cart.totalPrice },
        contextUpdates: { 
          checkoutReady: true, 
          cartAction: { checkoutUrl: url, totalPrice: cart.totalPrice } 
        },
      };
    }

    default:
      return { replyData: {}, contextUpdates: {} };
  }
}

/**
 * CODE decides which checkout field to ask for next — not the LLM.
 * This removes an entire class of LLM unpredictability.
 */
function handleCheckoutProgress(context: AgentContext): ExecutionResult {
  const draft = context.checkoutDraft ?? {};
  const order: (keyof typeof draft)[] = ["fullName", "email", "phone", "address1", "city", "zip"];
  
  const nextField = order.find(f => !draft[f]?.trim());

  if (!nextField) {
    // All fields present — trigger URL build
    return { replyData: { allFieldsCollected: true }, contextUpdates: {} };
  }

  return {
    replyData: { 
      nextField, 
      prompt: FIELD_PROMPTS[nextField as string] 
    },
    contextUpdates: {},
  };
}

function mergeResults(a: ExecutionResult, b: ExecutionResult): ExecutionResult {
  return {
    replyData: { ...a.replyData, ...b.replyData },
    contextUpdates: { ...a.contextUpdates, ...b.contextUpdates },
    products: b.products ?? a.products,
  };
}
```

---

## Step 4 — Reply Composer (Templates First, LLM Only When Needed)

**File:** `src/lib/shopify/reply-composer.ts`

```typescript
import Groq from "groq-sdk";
import type { Plan } from "./planner";
import type { ExecutionResult } from "./action-executor";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Template-based replies — instant, free, zero hallucination risk.
 * Covers ~90% of turns.
 */
export function composeFromTemplate(plan: Plan, exec: ExecutionResult): string | null {
  const d = exec.replyData;
  const lang = plan.language;

  switch (plan.replyTemplate) {

    case "single_match_confirm": {
      if (d.needsVariantChoice) {
        const options = d.variants.map((v: any) => v.title).join(", ");
        return t(lang, 
          `Found ${d.product.title}! It comes in: ${options}. Which one would you like?`,
          `${d.product.title} mil gaya! Ye options hain: ${options}. Konsa chahiye?`
        );
      }
      const qtyText = d.quantity > 1 ? `${d.quantity} pieces = PKR ${d.totalPrice} total` : `PKR ${d.unitPrice}`;
      return t(lang,
        `Found it! ${d.product.title} — PKR ${d.unitPrice} each. ${qtyText}. Want me to add it to your cart?`,
        `Mil gaya! ${d.product.title} — PKR ${d.unitPrice} each. ${qtyText}. Cart mein add karu?`
      );
    }

    case "added_confirmation": {
      if (d.error === "no_pending_product") return null; // needs LLM fallback
      const qtyPrefix = d.quantity > 1 ? `${d.quantity}x ` : "";
      return t(lang,
        `Done! ${qtyPrefix}${d.title} added to your cart 🛒 Ready to checkout?`,
        `Ho gaya! ${qtyPrefix}${d.title} cart mein add ho gaya 🛒 Checkout karna hai?`
      );
    }

    case "search_results": {
      if (!d.found) {
        return t(lang,
          `I couldn't find anything matching "${d.query}". Want me to show similar items?`,
          `"${d.query}" nahi mila. Kuch aur dikhaun?`
        );
      }
      return t(lang,
        `Here's what I found for "${d.query}":`,
        `"${d.query}" ke liye ye mile:`
      );
    }

    case "cart_summary": {
      const cart = d.cart;
      if (!cart?.lines?.length) {
        return t(lang, "Your cart is empty. What would you like to add?", "Aap ka cart khali hai. Kya add karna hai?");
      }
      const itemsText = cart.lines.map((l: any) => `${l.quantity}x ${l.title}`).join(", ");
      return t(lang,
        `Your cart: ${itemsText}. Total: PKR ${cart.totalPrice}.`,
        `Aap ka cart: ${itemsText}. Total: PKR ${cart.totalPrice}.`
      );
    }

    case "cart_cleared":
      return t(lang, "Done! Your cart is now empty.", "Ho gaya! Cart khali kar diya.");

    case "ask_checkout_field": {
      if (d.savedProfileFound) {
        const addr = d.profile.address;
        return t(lang,
          `I have your saved address: ${addr.address1}, ${addr.city}. Use this?`,
          `Aap ka saved address hai: ${addr.address1}, ${addr.city}. Yehi use karu?`
        );
      }
      if (d.invalidField === "email") {
        return t(lang, "That email doesn't look right. Can you try again?", "Email theek nahi laga. Dobara batayein?");
      }
      return d.prompt ?? null; // FIELD_PROMPTS already in plain English/Urdu
    }

    case "checkout_url_ready":
      return t(lang,
        `All set! Tap below to complete your order 🎉`,
        `Sab ready hai! Order complete karne ke liye neeche tap karein 🎉`
      );

    case "off_topic_redirect":
      return t(lang,
        "I'm here to help you shop! What are you looking for today?",
        "Main shopping mein madad karta hoon! Aaj kya dhoondh rahe hain?"
      );

    case "chitchat_reply":
      return t(lang, "Hi there! What can I help you find today?", "Hello! Aaj kya chahiye?");

    case "needs_clarification":
      return null; // fall through to LLM

    default:
      return null;
  }
}

/** tiny helper: pick English or Urdu/Roman-Urdu string */
function t(lang: string, en: string, ur: string): string {
  return lang === "en" ? en : ur;
}

/**
 * Fallback — only called when template returns null (genuinely novel situation).
 * This is the ONLY other LLM call, and it's lightweight (no tools, no loop).
 */
export async function composeWithLLM(
  plan: Plan, 
  exec: ExecutionResult, 
  userMessage: string
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",  // small model — just phrasing, not reasoning
    messages: [
      { 
        role: "system", 
        content: `You are a friendly Shopify sales assistant. Write ONE short, 
        natural reply (max 2 sentences) based on this situation. Be concise and helpful.
        Reply in ${plan.language === "en" ? "English" : "Roman Urdu"}.` 
      },
      { 
        role: "user", 
        content: `User said: "${userMessage}"\nSituation: ${plan.clarificationNeeded ?? JSON.stringify(exec.replyData)}\nWrite the reply.` 
      }
    ],
    max_tokens: 100,
    temperature: 0.5,
  });

  return response.choices[0].message.content ?? "Could you tell me more about what you're looking for?";
}
```

---

## Step 5 — Rewritten `chat/route.ts` (Orchestrator)

```typescript
import { generatePlan } from "@/lib/shopify/planner";
import { executePlan } from "@/lib/shopify/action-executor";
import { composeFromTemplate, composeWithLLM } from "@/lib/shopify/reply-composer";
import { getActiveStoreByDomain, buildStorefrontStore } from "@/lib/shopify/storefront";
import { getOrCreateSession, saveSessionState } from "@/lib/shopify/session";
import { assertQuotaOk } from "@/lib/usage/quota";
import { logUsage } from "@/lib/shopify/usage-logger";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let phase = "init";

  try {
    phase = "validate";
    const shopDomain = req.headers.get("X-Shop-Domain");
    const { message, sessionToken } = await req.json();
    if (!shopDomain || !message || !sessionToken) {
      return Response.json({ success: false, error: "Invalid request" }, { status: 400 });
    }

    phase = "store";
    const store = await getActiveStoreByDomain(shopDomain);
    if (!store) return Response.json({ success: false, error: "Store not found" }, { status: 404 });
    if (store.authStatus === "REAUTH_REQUIRED") {
      return Response.json({ success: false, error: "Reauth required" }, { status: 401 });
    }

    phase = "quota";
    await assertQuotaOk(store.projectId);

    phase = "session";
    const session = await getOrCreateSession(store.id, sessionToken, req.headers.get("x-forwarded-for"));
    const history = session.messages ?? [];
    const context = buildAgentContext(session.sessionContext, store);

    // ── SINGLE LLM CALL — Planning ──────────────────────────────────────
    phase = "plan";
    const stateSnapshot = buildStateSnapshot(context);
    const plan = await generatePlan(message, history, stateSnapshot);

    console.log("[chat] plan", { requestId, intent: plan.userIntent, template: plan.replyTemplate, actions: plan.actions.map(a => a.type) });

    // ── CODE EXECUTION — No LLM ─────────────────────────────────────────
    phase = "execute";
    const exec = await executePlan(plan, context);

    // ── REPLY — Template first, LLM fallback only if needed ────────────
    phase = "compose";
    let reply = composeFromTemplate(plan, exec);
    if (!reply) {
      reply = await composeWithLLM(plan, exec, message);
    }

    // ── Save session ─────────────────────────────────────────────────
    phase = "save";
    const updatedMessages = [...history, { role: "user", content: message }, { role: "assistant", content: reply }].slice(-20);
    saveSessionState(session.id, updatedMessages, { ...context, ...exec.contextUpdates }).catch(e => 
      console.error("[chat] session save failed (non-fatal)", e)
    );
    logUsage(store.projectId, "chat").catch(() => {});

    return Response.json({
      success: true,
      data: {
        message: reply,
        products: exec.products ?? [],
        cartAction: exec.contextUpdates.cartAction ?? context.cartAction ?? null,
        checkoutReady: exec.contextUpdates.checkoutReady ?? context.checkoutReady ?? false,
        checkoutUrl: exec.contextUpdates.cartAction?.checkoutUrl ?? context.cartAction?.checkoutUrl ?? null,
        sessionToken,
      }
    });

  } catch (error: any) {
    console.error("[chat] error", { requestId, phase, message: error?.message });
    return Response.json(
      { success: false, error: "internal_error", data: { message: "Something went wrong. Please try again.", products: [] } },
      { status: 500 }
    );
  }
}

function buildStateSnapshot(context: AgentContext): string {
  const cart = context.cartSummary 
    ? `Cart: ${context.cartSummary.lines?.length ?? 0} items, PKR ${context.cartSummary.totalPrice}` 
    : "Cart: empty";
  const checkout = Object.keys(context.checkoutDraft ?? {}).length > 0
    ? `Checkout collected: ${JSON.stringify(context.checkoutDraft)}`
    : "Checkout: not started";
  const pending = context.pendingAdd 
    ? `Pending product (awaiting confirm): ${context.pendingAdd.title} x${context.pendingAdd.quantity}`
    : "";
  return [cart, checkout, pending].filter(Boolean).join("\n");
}
```

---

## Cost & Performance Comparison

| Metric | Original (rules) | Phase 1/2 (pure agent loop) | Phase 3 (hybrid) |
|---|---|---|---|
| LLM calls per turn | 1-2 | 1-6 | **1** (rarely 2) |
| Tokens per turn | ~1500 | ~15,000-30,000 | **~1,500-2,500** |
| Latency per turn | Fast | Slow (multiple round trips) | **Fast** (single round trip) |
| Can chain actions (search+add) | ❌ No | ✅ Yes | ✅ **Yes** (plan has multiple actions) |
| Predictable/debuggable | ✅ Yes | ❌ Hard | ✅ **Yes** (plan is inspectable JSON) |
| Feels conversational/smart | ❌ No | ✅ Yes | ✅ **Yes** |
| Product selection logic | N/A | LLM guesses | **Deterministic scoring** |
| Checkout field sequencing | Hardcoded stage machine | LLM decides (inconsistent) | **Code decides** (consistent) |

---

## Why This Is "AI on the Surface, Code Underneath"

| What feels like AI to the user | What's actually happening in code |
|---|---|
| "Found it! 2 pieces = PKR 2398" | `rankProducts()` scoring + arithmetic, filled into a template string |
| Asks fields one at a time naturally | `handleCheckoutProgress()` — a simple array `.find()` |
| Picks the right variant automatically | `pickVariant()` — checks option count, no guessing |
| Remembers saved address | `findSavedProfile()` DB lookup, triggered by code right after email field saved |
| Handles "clear my cart" instantly | Direct `clear_cart` action dispatch, zero ambiguity |
| Responds in Urdu naturally | `language` field detected once by planner, then templates pick the right string |

**The LLM's only job: read the message once, output a small JSON plan. Everything else — search, scoring, cart math, field sequencing, URL building, even most replies — is fast, free, deterministic code.**

---

## Cursor Implementation Checklist

### New files
- [ ] `src/lib/shopify/planner.ts` — single-call planner with JSON schema above
- [ ] `src/lib/shopify/product-matcher.ts` — `rankProducts()`, `isConfidentMatch()`, `pickVariant()`
- [ ] `src/lib/shopify/action-executor.ts` — `executePlan()`, `executeAction()`, `handleCheckoutProgress()`
- [ ] `src/lib/shopify/reply-composer.ts` — `composeFromTemplate()`, `composeWithLLM()`

### Updated files
- [ ] `src/app/api/v1/shopify/chat/route.ts` — full rewrite per Step 5
- [ ] `src/lib/shopify/types.ts` — add `pendingAdd`, keep `AgentContext` shape from Phase 2
- [ ] `src/lib/shopify/checkout-url-builder.ts` — keep from Phase 2 unchanged

### Delete
- [ ] `src/lib/shopify/gpt-agent.ts` (old tool-loop version)
- [ ] `src/lib/shopify/intent-parser.ts` (if still present)
- [ ] `src/lib/shopify/query-recovery.ts` (if still present)

### Test cases — verify hybrid behaves identically to pure-agent UX
- [ ] "I want to buy 2 wireless chargers" → ONE plan call → search → confident match → quote price+total → "Sure" → add to cart (single template reply, no LLM call)
- [ ] "Show me phone cases" → search, show list (no auto-add since browse intent)
- [ ] "Clear my cart" → instant clear_cart action, template reply, zero ambiguity
- [ ] Checkout flow — fields asked one at a time via `handleCheckoutProgress()`, not LLM guessing
- [ ] Returning customer — saved address found right after email field via code, not LLM tool call
- [ ] Roman Urdu message → planner detects language once, all templates render in Urdu
- [ ] Genuinely ambiguous message → template returns null → triggers `composeWithLLM()` fallback (verify this is rare, log when it fires)
- [ ] Confirm total LLM calls per turn via logging — should be 1 for ~90% of turns, 2 max
- [ ] Confirm token usage per call stays under ~2500 tokens (log `response.usage` from Groq)

### Logging to add
- [ ] Log `plan` object on every turn (intent, template, actions) for debugging
- [ ] Log when `composeWithLLM()` fallback fires — track % of turns needing it
- [ ] Log Groq `usage.total_tokens` per call to monitor cost over time