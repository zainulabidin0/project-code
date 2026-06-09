# ShopAssist — Intent Agent & Shopify API Architecture

This document explains how the Shopify shopping assistant works: how user messages are interpreted, how Shopify Storefront API calls are made, and how natural-language replies are generated.

---

## High-Level Overview

The chat pipeline is a **two-stage AI system**:

1. **Intent parser** (`intent-parser.ts`) — Classifies what the shopper wants and extracts structured slots (search query, variant ID, product index, etc.).
2. **Response agent** (`gpt-agent.ts`) — Writes the friendly assistant reply based on execution results (products found, cart updated, checkout stage, etc.).

Between those two stages, the **orchestrator** (`chat/route.ts`) runs deterministic business logic: product search, cart mutations, checkout collection, and session state updates.

```
Shopper message
      │
      ▼
┌─────────────────────────────────────┐
│  POST /api/v1/shopify/chat          │  ← chat/route.ts (orchestrator)
└─────────────────────────────────────┘
      │
      ├─► parseIntent()          ← intent-parser.ts (Groq llama-3.1-8b-instant)
      │
      ├─► searchProducts()       ← storefront.ts → Shopify Storefront GraphQL
      ├─► addToCart()
      ├─► getCartSummary()
      ├─► applyCheckoutDetailsToCart()
      │
      ├─► runAgent()             ← gpt-agent.ts (Groq llama-3.3-70b-versatile)
      │
      └─► saveSessionState()     ← session.ts → PostgreSQL
```

---

## Entry Point

**File:** `src/app/api/v1/shopify/chat/route.ts`

### Request

| Field | Source |
|-------|--------|
| `X-Shop-Domain` header | Identifies the Shopify store |
| `message` | Shopper's text |
| `sessionToken` | Client-generated session ID (min 8 chars) |

### Core imports

```typescript
import { runAgent } from "@/lib/shopify/gpt-agent";
import { searchProducts, addToCart, getCartSummary, ... } from "@/lib/shopify/storefront";
import { parseIntent } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";
import { getOrCreateSession, parseMessages, parseSessionContext, saveSessionState } from "@/lib/shopify/session";
```

### POST handler flow

1. Validate `X-Shop-Domain` and request body
2. Load active store from DB (`getActiveStoreByDomain`)
3. Check usage quota (`assertQuotaOk`)
4. Load or create chat session + message history
5. Handle checkout-only turns (when `stage === "collecting_checkout"`)
6. **Parse intent** via `parseIntent(message, { history, context })`
7. **Execute intent** — search, select product, add to cart, start checkout
8. Determine `resultMode` (greeting, multi_results, no_results, cart_added, etc.)
9. **Generate reply** via `runAgent(...)` (or use a pre-built `assistantMessageOverride`)
10. Persist session + return JSON response

---

## Step 1 — Intent Understanding

**File:** `src/lib/shopify/intent-parser.ts`

### Supported intents

| Intent | Meaning |
|--------|---------|
| `product_search` | Find products by keyword |
| `browse_alternatives` | Show popular/other items after no results |
| `select_product` | Pick from previously shown products |
| `confirm_add_to_cart` | User says "yes" / "add it" |
| `add_to_cart` | Direct add with variant ID |
| `show_cart` | View cart |
| `start_checkout` | Begin checkout flow |
| `chitchat` | Greetings, store help |
| `off_topic` | Unrelated to shopping |

### Two-layer parsing strategy

**Layer 1 — Rule-based (fast, no LLM)**

Runs first via `ruleBasedIntent()`. Handles predictable patterns using session context:

```typescript
// Examples handled without LLM:
if (context?.selectedProduct && isDirectCartAddRequest(trimmed)) {
  return { intent: "confirm_add_to_cart", variantId, quantity, confidence: "high" };
}

if (context?.stage === "presenting_options") {
  const selection = resolveProductSelection(trimmed, context.lastProducts);
  if (selection) return { intent: "select_product", productIndex, variantId, ... };
}

if (isCheckoutIntent(trimmed)) {
  return { intent: "start_checkout", confidence: "high" };
}
```

Helper rules live in:
- `src/lib/shopify/product-selection.ts` — product picking, quantity parsing, purchase intent detection
- `src/lib/shopify/checkout-collector.ts` — checkout intent detection and delivery detail collection

**Layer 2 — Groq LLM (when rules don't match)**

```typescript
export async function parseIntent(message: string, opts?: ParseIntentOptions): Promise<ParsedIntent> {
  const ruleResult = ruleBasedIntent(trimmed, opts);
  if (ruleResult) return ruleResult;

  if (!getGroqKey()) {
    return buildFallbackPlan(trimmed); // treat message as raw search query
  }

  const result = await groqChatCompletion({
    model: GROQ_INTENT_MODEL, // "llama-3.1-8b-instant"
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildIntentSystemPrompt(opts?.context) },
      ...historyMessages,
      { role: "user", content: trimmed },
    ],
  });
  // ... parse JSON into ParsedIntent
}
```

The system prompt includes the current **conversation stage** and **products shown** so the model can route correctly (e.g. `select_product` when stage is `presenting_options`).

### Fallback when Groq is unavailable

```typescript
export function buildFallbackPlan(message: string): ParsedIntent {
  const normalized = normalizeShopifyQuery(message);
  const hints = inferSortHints(message); // "latest" → CREATED_AT desc, "cheap" → PRICE asc
  return {
    intent: "product_search",
    shopifyQuery: normalized || "products",
    sortKey: hints.sortKey,
    reverse: hints.reverse,
    confidence: "medium",
    needsClarification: false,
  };
}
```

---

## Step 2 — Shopify API Calls

**File:** `src/lib/shopify/storefront.ts`

All shopper-facing catalog/cart operations use the **Shopify Storefront GraphQL API** (version `2025-01`).

### Auth strategy

```typescript
async function storefrontFetch<T>(store, gqlQuery, variables): Promise<T> {
  // 1. Try tokenless access first
  const tokenless = await executeStorefrontRequest(store.shopDomain, gqlQuery, variables, null, "tokenless");
  if (tokenless.ok) return tokenless.data;

  // 2. Fall back to decrypted storefront token
  const token = getDecryptedStorefrontToken(store); // from tokens.ts
  const withToken = await executeStorefrontRequest(store.shopDomain, gqlQuery, variables, token, "token");

  // 3. On 401/403 → mark store REAUTH_REQUIRED
}
```

### Key exported functions

| Function | GraphQL operation | Purpose |
|----------|-------------------|---------|
| `searchProducts(store, plan)` | `products(query: ...)` | Product search with sort/filter |
| `addToCart({ store, variantId, quantity, cartId })` | `cartCreate` / `cartLinesAdd` | Add item to cart |
| `getCartSummary({ store, cartId })` | `cart` query | Cart total + checkout URL |
| `applyCheckoutDetailsToCart(...)` | `cartBuyerIdentityUpdate` + `cartDeliveryAddressesAdd` | Attach delivery info |
| `getCartCheckoutUrl(...)` | `cart` query | Get checkout link |

### Product search with query recovery

In `chat/route.ts`, failed searches trigger `recoverSearchPlan()`:

```typescript
try {
  products = await searchProducts(storefrontStore, searchPlan);
} catch (err) {
  if (err instanceof StorefrontRequestError && err.status === 400) {
    const recovery = await recoverSearchPlan({ userMessage, initialPlan: intent, failedQuery, errorMessage });
    if (recovery.status === "rewritten") {
      products = await searchProducts(storefrontStore, recovery.plan);
    }
  }
}
```

Recovery logic is in `src/lib/shopify/query-recovery.ts` (rule-based rewrites + optional Groq rewrite).

---

## Step 3 — Intent Execution (Orchestrator Logic)

**File:** `src/app/api/v1/shopify/chat/route.ts`

After `parseIntent()`, the route dispatches by intent:

```typescript
const intent = await parseIntent(parsed.data.message, { history, context: sessionContext });

// product_search → runProductSearch() → searchProducts()
if (intent.intent === "product_search" && !intent.needsClarification) {
  const searchResult = await runProductSearch(storefrontStore, intent, message);
  products = searchResult.products;
  sessionContext = applySearchResultsToContext(products, usedSearchQuery, sessionContext);
}

// browse_alternatives → search with sortKey BEST_SELLING
else if (intent.intent === "browse_alternatives") { ... }

// select_product → resolveProductSelection() from lastProducts
else if (intent.intent === "select_product") { ... }

// confirm_add_to_cart / add_to_cart → addToCart()
else if (intent.intent === "confirm_add_to_cart" || intent.intent === "add_to_cart") {
  const cart = await addToCart({ store, variantId, quantity, cartId: session.cartToken });
  sessionContext = buildSessionAfterCartAdd(...).sessionContext;
}

// start_checkout → beginCheckoutFromExistingCart() or resume collection
else if (intent.intent === "start_checkout") { ... }
```

### Conversation stages

**File:** `src/lib/shopify/types.ts`

```typescript
type ConversationStage =
  | "greeting"
  | "no_results"
  | "presenting_options"   // multiple products shown
  | "awaiting_confirm"     // single product selected, waiting for "yes"
  | "collecting_checkout"  // gathering name/email/address
  | "checkout_ready"       // all details saved, checkout URL available
  | "completed";
```

Stage transitions are updated in `applySearchResultsToContext()` and checkout helpers in `checkout-collector.ts`.

---

## Step 4 — Response Generation

**File:** `src/lib/shopify/gpt-agent.ts`

The response agent does **not** decide what action to take — it only writes the shopper-facing message based on `resultMode` and execution results.

```typescript
export async function runAgent(params: {
  storeName: string;
  userMessage: string;
  history: SessionMessage[];
  products: ShopifyProduct[];
  cartAction?: { checkoutUrl?, totalPrice?, cartId? };
  routingIntent?: string;
  resultMode?: "success" | "clarification" | "no_results" | "multi_results" | "greeting" | ...;
  clarification?: { question, suggestions };
  conversationStage?: ConversationStage;
  selectedProduct?: ShopifyProduct;
}) {
  const result = await groqChatCompletion({
    model: GROQ_CHAT_MODEL, // "llama-3.3-70b-versatile"
    messages: [
      { role: "system", content: buildSystemPrompt(storeName, opts) },
      ...history,
      { role: "user", content: `${userMessage}\n\nProduct context:\n${JSON.stringify(products)}` },
    ],
    max_tokens: 500,
    response_format: { type: "json_object" },
  });
  return parseAgentResponse(result.content);
}
```

### System prompt rules (examples)

- Never say "I'm searching" — results are already available
- `no_results` → clearly state item not found, offer alternatives
- `multi_results` → list each product with name and price
- `confirm_offer` → ask "Shall I add it to your cart?"
- `checkout_ready` → tell user to tap "Complete order", don't paste raw URLs

### Hardcoded overrides

Some turns skip the LLM entirely via `assistantMessageOverride`:
- Checkout field collection messages
- Cart-added confirmation intro
- Empty-cart checkout warning

---

## Step 5 — Session Persistence

**File:** `src/lib/shopify/session.ts`

Each chat session stores:
- `messages` — last 20 user/assistant turns (JSON)
- `sessionContext` — stage, lastProducts, selectedProduct, checkoutDraft, etc.
- `cartToken` — Shopify cart GID

```typescript
export async function getOrCreateSession(storeId, sessionToken, ip?) { ... }
export async function saveSessionState(sessionId, messages, context) { ... }
```

Default context on new session:

```typescript
export const DEFAULT_SESSION_CONTEXT: ChatSessionContext = { stage: "greeting" };
```

---

## API Response Shape

**File:** `src/app/api/v1/shopify/chat/route.ts` (end of POST handler)

```json
{
  "success": true,
  "data": {
    "message": "Assistant reply text",
    "intent": "product_search",
    "intentAgent": "product_search",
    "products": [],
    "cartAction": { "checkoutUrl": "...", "totalPrice": "29.99 USD", "cartId": "gid://..." },
    "checkoutReady": false,
    "needsClarification": false,
    "clarificationQuestion": null,
    "suggestions": [],
    "productSuggestions": [],
    "conversationStage": "presenting_options",
    "selectedProduct": null,
    "agentTrace": {
      "intent": "product_search",
      "usedQuery": "lemon wax",
      "sortKey": "RELEVANCE",
      "recovered": false,
      "stage": "presenting_options"
    },
    "sessionToken": "..."
  }
}
```

---

## LLM Client

**File:** `src/lib/groq/client.ts`

| Constant | Value | Used by |
|----------|-------|---------|
| `GROQ_INTENT_MODEL` | `llama-3.1-8b-instant` | Intent parsing |
| `GROQ_CHAT_MODEL` | `llama-3.3-70b-versatile` | Response agent |
| `GROQ_WHISPER_MODEL` | `whisper-large-v3-turbo` | Voice transcription |

Requires `GROQ_API_KEY` in `.env`. Without it, intent falls back to keyword search and replies use hardcoded messages.

---

## Supporting Files Reference

| File | Role |
|------|------|
| `src/lib/shopify/types.ts` | Shared TypeScript types |
| `src/lib/shopify/product-selection.ts` | Product/variant resolution rules |
| `src/lib/shopify/checkout-collector.ts` | Multi-step checkout detail collection |
| `src/lib/shopify/query-recovery.ts` | Failed search query recovery |
| `src/lib/shopify/store.ts` | DB lookup for Shopify store config |
| `src/lib/shopify/tokens.ts` | Encrypt/decrypt storefront tokens |
| `src/app/api/v1/shopify/cart/route.ts` | Direct cart-add endpoint (bypasses agent) |
| `src/app/api/v1/shopify/voice/route.ts` | Voice → text → chat pipeline |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Powers intent parsing and response generation |
| `DATABASE_URL` | Session and store persistence |
| `ENCRYPTION_KEY` | Decrypt stored Shopify tokens |

---

## Example End-to-End Flow

**User:** "I want lemon wax"

1. `parseIntent` → `{ intent: "product_search", shopifyQuery: "lemon wax" }`
2. `searchProducts(store, { query: "lemon wax" })` → 2 products found
3. `sessionContext.stage` → `"presenting_options"`
4. `resultMode` → `"multi_results"`
5. `runAgent` → *"I found 2 options: Lemon Wax ($12) and Premium Lemon Wax ($18). Which would you like?"*

**User:** "the first one"

6. `parseIntent` (rule-based) → `{ intent: "select_product", productIndex: 0 }`
7. `sessionContext.stage` → `"awaiting_confirm"`, `selectedProduct` set
8. `runAgent` → *"Great choice — Lemon Wax ($12). Shall I add it to your cart?"*

**User:** "yes please"

9. `parseIntent` (rule-based) → `{ intent: "confirm_add_to_cart", variantId: "gid://..." }`
10. `addToCart(...)` → cart updated
11. `sessionContext.stage` → `"collecting_checkout"` (checkout collection begins)
12. `runAgent` → *"Added to your cart! What's your full name for delivery?"*

---

## Tests

| File | What it tests |
|------|---------------|
| `src/lib/shopify/agent-planner.test.ts` | `parseIntent` rule routing |
| `src/lib/shopify/product-selection.test.ts` | Product/variant selection |
| `src/lib/shopify/checkout-collector.test.ts` | Checkout flow helpers |
