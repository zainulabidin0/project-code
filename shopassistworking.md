# ShopAssist — How Everything Works

This document explains **ShopAssist** end to end: what it is, how a Shopify store connects, how the storefront widget talks to the backend, how chat/voice/cart/checkout flows run, and how product review sentiment fits in.

ShopAssist lives inside **`project-2`** (AddressFix / Quick POS). It is not a separate repo — it is a feature module built on Next.js with PostgreSQL, Groq LLMs, Shopify APIs, and an optional Python sentiment microservice.

---

## Table of contents

1. [What ShopAssist is](#1-what-shopassist-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Store connection (OAuth)](#3-store-connection-oauth)
4. [Database tables](#4-database-tables)
5. [Storefront widget (`widget.js`)](#5-storefront-widget-widgetjs)
6. [Chat API — the orchestrator](#6-chat-api--the-orchestrator)
7. [Intent parsing (what the shopper wants)](#7-intent-parsing-what-the-shopper-wants)
8. [Shopify Storefront API (catalog + cart)](#8-shopify-storefront-api-catalog--cart)
9. [Response agent (what the assistant says)](#9-response-agent-what-the-assistant-says)
10. [Conversation stages](#10-conversation-stages)
11. [Checkout collection flow](#11-checkout-collection-flow)
12. [Voice: speech-to-text and text-to-speech](#12-voice-speech-to-text-and-text-to-speech)
13. [Product review sentiment](#13-product-review-sentiment)
14. [Usage, quotas, and logging](#14-usage-quotas-and-logging)
15. [API reference (quick)](#15-api-reference-quick)
16. [Environment variables](#16-environment-variables)
17. [End-to-end example conversations](#17-end-to-end-example-conversations)
18. [Source file map](#18-source-file-map)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. What ShopAssist is

ShopAssist is an **AI shopping assistant** that merchants embed on their Shopify storefront. Shoppers can:

- **Search** products in natural language
- **Pick** items from a list (by number, name, or variant)
- **Add to cart** via chat
- **Complete checkout** by giving delivery details in chat (name, email, phone, address)
- **Use voice** (mic → transcription → chat → optional spoken reply)
- **Submit product reviews** that are scored for positive/negative sentiment

From the merchant side, ShopAssist is configured in the dashboard at:

```
/projects/<projectId>/shopassist
```

One **project** can have **one connected Shopify store** (`shopify_stores.projectId` is unique).

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Shopify storefront (customer browser)                                  │
│  ┌──────────────────┐                                                   │
│  │  widget.js       │  floating chat + voice UI                         │
│  │  (script tag)    │                                                   │
│  └────────┬─────────┘                                                   │
└───────────┼─────────────────────────────────────────────────────────────┘
            │  HTTPS
            │  X-Shop-Domain: mystore.myshopify.com
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Next.js app (project-2)                                                │
│                                                                         │
│  /api/v1/shopify/chat      ← main orchestrator                        │
│  /api/v1/shopify/voice     ← Groq Whisper STT                         │
│  /api/v1/shopify/speak     ← Groq Orpheus TTS                         │
│  /api/v1/shopify/cart      ← direct cart add (bypasses full chat)       │
│  /api/v1/shopify/widget-config                                          │
│  /api/v1/shopify/sentiment* ← review scoring                           │
│                                                                         │
│  /api/shopify/install      ← OAuth start                                │
│  /api/shopify/callback     ← OAuth finish + DB + script tag             │
│  /api/shopify/webhooks     ← app/uninstalled                            │
└───────────┬───────────────────────────────┬─────────────────────────────┘
            │                               │
            ▼                               ▼
   ┌────────────────┐              ┌─────────────────────┐
   │  PostgreSQL    │              │  External services   │
   │  sessions,     │              │  • Shopify Admin API │
   │  stores,       │              │  • Shopify Storefront│
   │  reviews,      │              │    GraphQL API       │
   │  usage logs    │              │  • Groq (LLM/STT/TTS)│
   └────────────────┘              │  • Python sentiment  │
                                     │    (FastAPI/sklearn) │
                                     └─────────────────────┘
```

### The chat pipeline is a two-stage AI system

| Stage | File | Model | Job |
|-------|------|-------|-----|
| **Intent parser** | `src/lib/shopify/intent-parser.ts` | Groq `llama-3.1-8b-instant` | Classify intent + extract slots (query, variant ID, product index, quantity) |
| **Business logic** | `src/app/api/v1/shopify/chat/route.ts` | None (deterministic) | Search Shopify, mutate cart, advance checkout, update session |
| **Response agent** | `src/lib/shopify/gpt-agent.ts` | Groq `llama-3.3-70b-versatile` | Write the friendly reply the shopper sees |

The response agent **does not decide actions** — it only narrates what already happened.

---

## 3. Store connection (OAuth)

### 3.1 Merchant flow (dashboard)

1. Merchant opens `/projects/<id>/shopassist`.
2. Enters `mystore.myshopify.com` (no `https://`).
3. Clicks **Install on Shopify** → browser goes to `/api/shopify/install?shop=...&projectId=...`.
4. Shopify permission screen → merchant approves.
5. Shopify redirects to `/api/shopify/callback?code=...&shop=...&state=...&hmac=...`.
6. App saves the store and redirects back to the ShopAssist dashboard page.

### 3.2 Install route (`/api/shopify/install`)

**File:** `src/app/api/shopify/install/route.ts`

- Validates `shop` ends with `.myshopify.com`.
- Builds a **state** token: base64url JSON `{ projectId, ts }` so the callback knows which project to attach the store to.
- Redirects to Shopify OAuth authorize URL via `getInstallUrl()` in `src/lib/shopify/oauth.ts`.

### 3.3 Callback route (`/api/shopify/callback`)

**File:** `src/app/api/shopify/callback/route.ts`

On successful callback:

1. **Verify HMAC** on query params (`verifyHmac`) — rejects tampered callbacks.
2. **Exchange** `code` for Admin API `accessToken` (`exchangeToken`).
3. **Fetch** shop display name (`fetchShopifyShopName`).
4. **Detect theme** OS 1.0 vs OS 2.0 (`getThemeInfo`) — OS 2.0 themes may not show script tags automatically.
5. **Register webhook** `app/uninstalled` → `/api/shopify/webhooks`.
6. **Install script tag** pointing at `widget.js` with `?shop=...&api=...` (`installScriptTag`).
7. **Encrypt** access token with AES (`ENCRYPTION_KEY`) before saving to DB.
8. **Upsert** row in `shopify_stores` (one store per project).

Required Shopify Admin scopes (from app config):

- `read_products`
- `write_script_tags`
- `write_checkouts`

### 3.4 Optional Storefront API token

**Dashboard:** ShopAssist page → **Storefront API token (optional)**

**API:** `POST /api/dashboard/shopassist/storefront-token`

The app can call Shopify's **Storefront GraphQL API** in two ways:

1. **Tokenless** (tried first) — Shopify allows unauthenticated storefront queries for public catalog/cart on supported API versions.
2. **With token** — decrypted `storefrontToken` from DB if tokenless fails or merchant saved a token.

### 3.5 Uninstall and re-auth

| Event | What happens |
|-------|----------------|
| Merchant uninstalls app | Webhook `app/uninstalled` sets `isActive=false`, `authStatus=UNINSTALLED` |
| Storefront returns 401/403 | `authStatus` can become `REAUTH_REQUIRED`; dashboard shows reconnect button |
| Merchant disconnects in dashboard | `PATCH /api/dashboard/projects/:id/shopassist` with `{ disconnect: true }` |

### 3.6 Widget injection

**File:** `src/lib/shopify/admin.ts` → `installScriptTag()`

Builds script URL:

```
{NEXT_PUBLIC_WIDGET_URL}?shop={shop}&api={NEXT_PUBLIC_APP_URL}
```

Example: `https://yourapp.com/widget.js?shop=mystore.myshopify.com&api=https%3A%2F%2Fyourapp.com`

For **Online Store 2.0** themes, script tags may not render on all pages. The dashboard warns merchants to add the widget via **Theme Editor → Add section → Apps** instead.

---

## 4. Database tables

**Schema file:** `src/lib/db/schema.ts`

### `shopify_stores`

| Column | Purpose |
|--------|---------|
| `projectId` | Links store to AddressFix project (unique — one store per project) |
| `shopDomain` | e.g. `mystore.myshopify.com` (unique) |
| `accessToken` | Encrypted Shopify Admin token |
| `storefrontToken` | Optional encrypted Storefront API token |
| `widgetPosition` | `bottom-right` or `bottom-left` |
| `widgetColor` | Hex color for widget chrome |
| `widgetGreeting` | First message shown in chat |
| `isActive` | Whether connection is live |
| `authStatus` | `ACTIVE`, `REAUTH_REQUIRED`, `UNINSTALLED` |
| `themeVersion` | `os1`, `os2`, or `unknown` |

### `shop_chat_sessions`

| Column | Purpose |
|--------|---------|
| `storeId` | Which store this session belongs to |
| `sessionToken` | Client-generated ID (widget stores in `localStorage`) |
| `cartToken` | Shopify cart GID (`gid://shopify/Cart/...`) |
| `messages` | JSON array of last ~20 `{ role, content }` turns |
| `sessionContext` | JSON: stage, lastProducts, selectedProduct, checkoutDraft, etc. |
| `ip` | Optional client IP |

### `shop_customer_profiles`

Saved checkout details keyed by email (or other identifier) so returning shoppers can reuse address.

### `shop_usage_logs`

Per-action metering: `chat`, `voice`, `tts`, `cart_add`, `sentiment`, `sentiment_batch`.

### `reviews`

Product review text + ML sentiment result, linked to `projectId` (same project as the store).

---

## 5. Storefront widget (`widget.js`)

**File:** `public/widget.js` — plain JavaScript IIFE, no build step. Loaded via Shopify script tag.

### 5.1 Bootstrap

On load, the widget:

1. Reads **`shop`** from (in order): `data-shop` attribute, script URL query `?shop=`, or page query string.
2. Reads **`api`** base URL from `data-api`, script `?api=`, or script origin. Defaults to `https://addressfix.dev`.
3. Exits silently if `shop` is missing.
4. Creates or loads **`sessionToken`** from `localStorage` key `af_sess_{shop}` (min 8 chars; generated with `crypto.getRandomValues` when available).
5. Fetches **`GET /api/v1/shopify/widget-config?shop=...`** for position, color, greeting, store name.
6. Injects responsive CSS and builds the floating button + chat panel DOM.

### 5.2 Chat send flow

When the shopper sends a message:

```javascript
POST /api/v1/shopify/chat
Headers: Content-Type: application/json, X-Shop-Domain: {shop}
Body: { message, sessionToken }
```

The widget then:

- Renders assistant `message` text
- Renders **product cards** if `data.products` is non-empty (image, price, variant picker, Add to cart)
- Renders **suggestion chips** for clarifications or product alternatives
- Shows **"Complete order →"** link when `checkoutReady` and `cartAction.checkoutUrl` exist
- Auto-opens checkout tab when `redirectToCheckout` is true

### 5.3 Direct cart from product cards

Product cards can call **`POST /api/v1/shopify/cart`** directly (faster than typing "add to cart" in chat). Same `X-Shop-Domain` + `sessionToken` headers.

### 5.4 Voice mode

1. User taps mic → `MediaRecorder` captures audio (webm/ogg depending on browser).
2. **`POST /api/v1/shopify/voice`** with `FormData` field `audio`.
3. Server returns `{ transcript }` via Groq Whisper.
4. Transcript is sent through the normal **`/chat`** pipeline.
5. If voice reply mode is on, assistant text is sent to **`POST /api/v1/shopify/speak`** → base64 WAV chunks played in browser.

---

## 6. Chat API — the orchestrator

**File:** `src/app/api/v1/shopify/chat/route.ts`

This is the **brain** of ShopAssist. Every shopper message (except pure voice upload) ends up here.

### 6.1 Request validation

| Input | Rule |
|-------|------|
| Header `X-Shop-Domain` | Required — identifies store |
| Body `message` | 1–2000 characters |
| Body `sessionToken` | Min 8 characters |

### 6.2 Pre-flight checks

1. **`getActiveStoreByDomain(shopDomain)`** — load store row; 404 if missing.
2. **`authStatus === REAUTH_REQUIRED`** → 401.
3. **`assertQuotaOk(projectId)`** — monthly plan limit; 429 if exceeded.
4. **`getOrCreateSession(storeId, sessionToken, ip)`** — load or create DB session.
5. Parse **`history`** from `session.messages` and **`sessionContext`** from `session.sessionContext`.

### 6.3 Checkout-only turns

If `sessionContext.stage === "collecting_checkout"` and a `checkoutField` is set, the route may **skip intent parsing** and treat the message as the answer to the current checkout question (name, email, phone, address line, city, province, zip).

Special handling:

- **Name normalization** via Groq (`normalizeFullNameInput`) — rejects gibberish, fixes casing.
- **Email normalization** — validates format.
- **Saved profile lookup** — if email matches a saved `shop_customer_profiles` row, offer to reuse address.
- On complete draft → **`applyCheckoutDetailsToCart`** on Shopify → `checkout_ready` stage.

### 6.4 Normal turns (shopping)

1. **`parseIntent(message, { history, context })`** — see [§7](#7-intent-parsing-what-the-shopper-wants).
2. **Execute intent** — search, select, add to cart, show cart, start checkout — see orchestrator branches in the route file.
3. Compute **`resultMode`** — e.g. `greeting`, `multi_results`, `no_results`, `cart_added`, `checkout_ready`.
4. **`runAgent(...)`** or use **`assistantMessageOverride`** for deterministic messages (checkout prompts, validation errors).
5. **`saveSessionState(sessionId, messages, context)`** — persist to PostgreSQL.
6. **`shopUsageLogs`** insert for `chat` action.
7. Return JSON payload (see [§6.6](#66-response-shape)).

### 6.5 Product search helper (`runProductSearch`)

1. Map intent to `ProductSearchPlan` (`query`, `sortKey`, `reverse`, `first: 5`).
2. Call **`searchProducts(storefrontStore, plan)`**.
3. On Storefront **400** error → **`recoverSearchPlan()`** may rewrite the query and retry.
4. Optionally **`filterProductsBySearchRelevance`** to drop weak matches.
5. **`applySearchResultsToContext`** updates conversation stage based on result count.

### 6.6 Response shape

```json
{
  "success": true,
  "data": {
    "message": "Assistant reply text",
    "intent": "product_search",
    "products": [],
    "cartAction": {
      "checkoutUrl": "https://...",
      "totalPrice": "29.99 USD",
      "cartId": "gid://shopify/Cart/..."
    },
    "checkoutReady": false,
    "redirectToCheckout": false,
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
    "sessionToken": "sess_..."
  }
}
```

---

## 7. Intent parsing (what the shopper wants)

**File:** `src/lib/shopify/intent-parser.ts`

### 7.1 Supported intents

| Intent | When it fires |
|--------|----------------|
| `product_search` | Shopper describes what they want |
| `browse_alternatives` | After no results — show popular items |
| `select_product` | Pick from `lastProducts` ("first one", "the blue shirt") |
| `confirm_add_to_cart` | "yes", "add it" when a product is already selected |
| `add_to_cart` | Direct add with variant ID |
| `show_cart` | "what's in my cart" |
| `start_checkout` | "checkout", "pay now", etc. (incl. Urdu/Hindi phrases) |
| `chitchat` | Greetings, store help |
| `off_topic` | Not about shopping |

### 7.2 Two-layer strategy

#### Layer 1 — Rule-based (no LLM, fast)

`ruleBasedIntent()` runs **first**. Examples:

- User said "yes" + `selectedProduct` exists → `confirm_add_to_cart`
- `stage === presenting_options` + "number 2" → `select_product` with `productIndex`
- `isCheckoutIntent(message)` → `start_checkout`
- `isShowCartIntent(message)` → `show_cart`

Rules live in:

- `src/lib/shopify/product-selection.ts` — quantity parsing, variant resolution, purchase phrases
- `src/lib/shopify/checkout-collector.ts` — checkout intent regexes

#### Layer 2 — Groq LLM

If rules do not match and `GROQ_API_KEY` is set:

- Model: **`llama-3.1-8b-instant`**
- **`response_format: json_object`**
- System prompt includes current **stage** and **products shown** so the model can route e.g. `select_product` correctly.

#### Fallback (no Groq)

`buildFallbackPlan(message)` treats the message as a **raw product search**:

- Strips filler words (`show me`, `please`, etc.)
- Infers sort from keywords: "latest" → `CREATED_AT desc`, "cheap" → `PRICE asc`, "popular" → `BEST_SELLING`

### 7.3 Query recovery

**File:** `src/lib/shopify/query-recovery.ts`

If Shopify returns 400 on a search query, recovery can:

- Rewrite the query (rules + optional Groq)
- Or return a **clarification** with suggested searches

---

## 8. Shopify Storefront API (catalog + cart)

**File:** `src/lib/shopify/storefront.ts`

**API version:** `2025-10` (constant `STOREFRONT_API_VERSION`)

### 8.1 Auth waterfall

```
storefrontFetch()
  1. Try tokenless request (no Authorization header)
  2. If fail → decrypt storefrontToken from DB
  3. If 401/403 → mark store REAUTH_REQUIRED in DB
```

### 8.2 Key operations

| Function | GraphQL | Purpose |
|----------|---------|---------|
| `searchProducts` | `products(query, sortKey, ...)` | Catalog search |
| `addToCart` | `cartCreate` or `cartLinesAdd` | Add line items |
| `getCartSummary` | `cart` query | Totals + checkout URL |
| `getCartWithLines` | `cart` with lines | Show cart contents in chat |
| `applyCheckoutDetailsToCart` | `cartBuyerIdentityUpdate` + `cartDeliveryAddressesAdd` | Attach buyer + delivery address |
| `getCartCheckoutUrl` | `cart` query | Final checkout link |

### 8.3 Search query building

`buildSearchQuery()` can combine:

- Free text query
- `tag:{color}`
- `variants.price:<{max}`
- `product_type:{category}`
- `variants.option:{size}`

Noise words (`show`, `me`, `products`, etc.) are stripped in `buildSearchQuery` / `normalizeShopifyQuery`.

### 8.4 Cart lifecycle

- First add → **`cartCreate`** → `cartToken` saved on `shop_chat_sessions`
- Subsequent adds → **`cartLinesAdd`** with existing `cartId`
- Checkout URL comes from Shopify cart's `checkoutUrl` field (may be enriched with prefilled params in `checkout-collector.ts`)

---

## 9. Response agent (what the assistant says)

**File:** `src/lib/shopify/gpt-agent.ts`

- Model: **`llama-3.3-70b-versatile`**
- Input: store name, user message, history, products, `resultMode`, cart hints, checkout stage
- Output: JSON `{ intent, message, query?, variantId? }`

### Important prompt rules

- Never say "I'm searching" — results are already fetched
- `multi_results` → list each product with name + price, ask which one
- `confirm_offer` → ask "Shall I add it to your cart?"
- `checkout_ready` → tell user to tap Complete order; don't paste raw URLs in prose
- `off_topic` → politely redirect to shopping

### Hardcoded overrides (`assistantMessageOverride`)

Some turns **skip the LLM** entirely:

- Checkout field questions (`getCheckoutQuestion`)
- Invalid name/email validation messages
- Empty cart checkout warning
- Saved address summary prompts

If `GROQ_API_KEY` is missing, the agent uses **template fallbacks** in `gpt-agent.ts` instead of calling Groq.

---

## 10. Conversation stages

**Type:** `ConversationStage` in `src/lib/shopify/types.ts`

| Stage | Meaning |
|-------|---------|
| `greeting` | New session |
| `no_results` | Search returned zero products |
| `presenting_options` | Multiple products shown |
| `selecting_variant` | User must pick size/color |
| `awaiting_quantity` | "How many?" |
| `awaiting_cart_confirm` | Confirm qty × product before add |
| `awaiting_confirm` | Single product — confirm add |
| `cart_added_pause` | Just added — optional pause before checkout questions |
| `confirming_saved_address` | Offer to reuse saved delivery profile |
| `collecting_checkout` | Collecting name → email → phone → address fields |
| `checkout_ready` | All details on cart; checkout URL available |
| `completed` | Order flow finished |

### Stage transitions (examples)

- Search returns **0** products → `no_results`
- Search returns **1** product → `awaiting_confirm` (+ `selectedProduct`)
- Search returns **2+** → `presenting_options` (+ `lastProducts`)
- User confirms add → cart mutation → often `collecting_checkout` or `cart_added_pause`
- All checkout fields filled + applied to cart → `checkout_ready`

**Persistence:** `sessionContext` JSON column on `shop_chat_sessions`, updated every turn via `saveSessionState()`.

---

## 11. Checkout collection flow

**File:** `src/lib/shopify/checkout-collector.ts`

### 11.1 Field order

Collected in sequence:

1. `fullName`
2. `email`
3. `phone`
4. `address1`
5. `address2` (optional — can skip with "none")
6. `city`
7. `province`
8. `zip`

Default country: **`PK` (Pakistan)** with province code mapping (Punjab → `PB`, etc.). City names like "Lahore" can infer province.

### 11.2 Checkout intent detection

Regex covers English and some Roman Urdu/Hindi:

- `checkout`, `pay now`, `place order`, `checkout kr`, `ab pay`, etc.

### 11.3 Saved customer profiles

**File:** `src/lib/shopify/customer-profile.ts`

When email is collected, the system may find a prior `shop_customer_profiles` row and ask:

> "I have your saved address: … Shall I use it?"

If yes, draft is merged and cart is updated without re-asking every field.

### 11.4 Applying to Shopify cart

`toCartCheckoutDetails(draft)` → `applyCheckoutDetailsToCart()`:

- Sets buyer identity (email, phone, name)
- Adds delivery address on the cart
- Returns updated `checkoutUrl` (sometimes with prefilled query params via `enrichCheckoutUrlWithDraft`)

---

## 12. Voice: speech-to-text and text-to-speech

### 12.1 Speech-to-text (STT)

**Route:** `POST /api/v1/shopify/voice`  
**File:** `src/lib/shopify/whisper.ts`  
**Model:** Groq `whisper-large-v3-turbo`

Flow:

1. Widget uploads audio file as `multipart/form-data` field `audio`.
2. Server transcribes → returns `{ transcript }`.
3. Widget feeds transcript into `/chat` as if the user typed it.

### 12.2 Text-to-speech (TTS)

**Route:** `POST /api/v1/shopify/speak`  
**File:** `src/lib/shopify/tts.ts`  
**Model:** Groq Orpheus voices (`hannah` English, `fahad` Arabic — configurable via env)

Body: `{ text, lang?: "en" | "ar" }`

Response: `{ chunks: ["base64-wav", ...], contentType: "audio/wav" }`

**Note:** Orpheus may require one-time terms acceptance in Groq Console (`TTS_TERMS_REQUIRED` error).

---

## 13. Product review sentiment

ShopAssist shares the project's **review sentiment** stack for product pages.

### 13.1 APIs

| Route | Purpose |
|-------|---------|
| `POST /api/v1/shopify/sentiment` | Score one review |
| `POST /api/v1/shopify/sentiment/batch` | Score up to N reviews |

**Auth:** `X-Shop-Domain` header (store must be connected). No separate API key on the storefront — domain identifies the project.

**Handler:** `src/lib/shopify/sentiment-handler.ts`

### 13.2 ML pipeline

1. Next.js calls **`predictSentiment(review)`** in `src/lib/sentiment/client.ts`.
2. Client ensures Python service is running (`ensurePythonProcess()` in `process-manager.ts`).
3. Python FastAPI app (`python-service/model.py`):
   - Loads `sentiment_model.pkl` + `vectorizer.pkl` (sklearn joblib) on startup
   - `POST /predict` → `{ sentiment: POSITIVE|NEGATIVE, score: 1|-1, confidence: 0-100 }`
   - `POST /predict/batch` → up to 50 reviews

### 13.3 Storage

Each review is inserted into **`reviews`** table with sentiment, score, confidence, `reviewerMeta` (includes `shopDomain`, `source: shopify-product-page`).

**Storefront snippet:** `public/shopify/product-review-form.liquid` — Liquid template merchants add to product pages.

### 13.4 Local vs production Python

| Mode | Config |
|------|--------|
| Local dev | Spawns `uvicorn model:app` on `PYTHON_SERVICE_PORT` (default 8100) |
| Production | Set `SENTIMENT_SERVICE_URL` to hosted FastAPI (Railway, Render, etc.) |

---

## 14. Usage, quotas, and logging

**Quota check:** `src/lib/usage/quota.ts` → `assertQuotaOk(projectId)`

Every chat, voice, TTS, cart, and sentiment call checks monthly limits based on the project's plan (`PLAN_LIMITS` in `src/lib/rate-limit/plans.ts`).

**Logging:** `shop_usage_logs` with `actionType`:

| actionType | Trigger |
|------------|---------|
| `chat` | `/api/v1/shopify/chat` |
| `voice` | `/api/v1/shopify/voice` |
| `tts` | `/api/v1/shopify/speak` |
| `cart_add` | `/api/v1/shopify/cart` |
| `sentiment` | single review |
| `sentiment_batch` | batch reviews |

Dashboard ShopAssist page shows monthly counts per action type.

---

## 15. API reference (quick)

### Storefront-facing (widget)

| Method | Path | Headers | Body |
|--------|------|---------|------|
| GET | `/api/v1/shopify/widget-config?shop=` | — | — |
| POST | `/api/v1/shopify/chat` | `X-Shop-Domain` | `{ message, sessionToken }` |
| POST | `/api/v1/shopify/cart` | `X-Shop-Domain` | `{ variantId, quantity, sessionToken }` |
| POST | `/api/v1/shopify/voice` | `X-Shop-Domain` | `multipart: audio` |
| POST | `/api/v1/shopify/speak` | `X-Shop-Domain` | `{ text, lang? }` |
| POST | `/api/v1/shopify/sentiment` | `X-Shop-Domain` | `{ review, reviewerName?, reviewerMeta? }` |

### OAuth / admin

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/shopify/install?shop=&projectId=` | Start OAuth |
| GET | `/api/shopify/callback` | OAuth callback (Shopify → app) |
| POST | `/api/shopify/webhooks` | `app/uninstalled` |

### Dashboard (authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/projects/:id/shopassist` | Store status + usage |
| PATCH | `/api/dashboard/projects/:id/shopassist` | Widget settings / disconnect |
| POST | `/api/dashboard/shopassist/storefront-token` | Save Storefront token |

---

## 16. Environment variables

| Variable | Role |
|----------|------|
| `DATABASE_URL` | PostgreSQL for stores, sessions, reviews |
| `GROQ_API_KEY` | Intent LLM, chat LLM, Whisper STT, Orpheus TTS |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | OAuth |
| `SHOPIFY_WEBHOOK_SECRET` | Verify webhook HMAC |
| `ENCRYPTION_KEY` | 32-byte hex — encrypt Admin + Storefront tokens at rest |
| `NEXT_PUBLIC_APP_URL` | Public app URL for OAuth callbacks and widget `api=` param |
| `NEXT_PUBLIC_WIDGET_URL` | Full URL to `widget.js` for script tag |
| `PYTHON_SERVICE_PORT` | Local sentiment service port (default 8100) |
| `SENTIMENT_SERVICE_URL` | Production sentiment service base URL |
| `GROQ_TTS_VOICE` / `GROQ_TTS_VOICE_AR` | Optional TTS voice overrides |

See `.env.example` for the full list.

---

## 17. End-to-end example conversations

### Example A — Search, select, add, checkout

| Turn | User | System internals | Stage after |
|------|------|------------------|-------------|
| 1 | "I want lemon wax" | `parseIntent` → `product_search`; `searchProducts("lemon wax")` → 2 hits; `resultMode=multi_results`; `runAgent` lists options | `presenting_options` |
| 2 | "the first one" | Rule: `select_product`, index 0; `resultMode=confirm_offer` | `awaiting_confirm` |
| 3 | "yes please" | Rule: `confirm_add_to_cart`; `addToCart`; `resultMode=cart_added` | `collecting_checkout` |
| 4 | "Ali Khan" | Checkout-only turn; `processCheckoutAnswer` → next field email | `collecting_checkout` |
| 5 | "ali@example.com" | Email saved; maybe saved profile prompt | `collecting_checkout` |
| … | address fields | `applyCheckoutDetailsToCart` | `checkout_ready` |
| last | — | Widget shows **Complete order →** with `checkoutUrl` | `checkout_ready` |

### Example B — Voice

1. User holds mic → audio → `/voice` → transcript "show me jackets"
2. Transcript → `/chat` → same as typed message
3. If voice reply enabled → `/speak` plays assistant response

### Example C — No results → alternatives

1. "purple unicorn helmet" → 0 products → `no_results`
2. User: "show me something else" → `browse_alternatives` → search with `BEST_SELLING`

---

## 18. Source file map

| Area | Files |
|------|-------|
| **Chat orchestrator** | `src/app/api/v1/shopify/chat/route.ts` |
| **Intent** | `src/lib/shopify/intent-parser.ts`, `product-selection.ts`, `query-recovery.ts` |
| **Response** | `src/lib/shopify/gpt-agent.ts` |
| **Shopify API** | `src/lib/shopify/storefront.ts`, `admin.ts`, `oauth.ts`, `tokens.ts`, `encrypt.ts` |
| **Session** | `src/lib/shopify/session.ts`, `types.ts` |
| **Checkout** | `src/lib/shopify/checkout-collector.ts`, `customer-profile.ts`, `name-normalizer.ts`, `email-normalizer.ts` |
| **Groq** | `src/lib/groq/client.ts` |
| **Voice** | `src/lib/shopify/whisper.ts`, `tts.ts`, `src/app/api/v1/shopify/voice/route.ts`, `speak/route.ts` |
| **Widget** | `public/widget.js` |
| **OAuth routes** | `src/app/api/shopify/install/route.ts`, `callback/route.ts`, `webhooks/route.ts` |
| **Dashboard** | `src/app/(dashboard)/projects/[id]/shopassist/page.tsx` |
| **Sentiment** | `src/lib/shopify/sentiment-handler.ts`, `src/lib/sentiment/client.ts`, `python-service/model.py` |
| **DB schema** | `src/lib/db/schema.ts` |
| **Tests** | `agent-planner.test.ts`, `product-selection.test.ts`, `checkout-collector.test.ts` |
| **Architecture (shorter)** | `docs/SHOPIFY_AGENT_ARCHITECTURE.md` |
| **Connection guide** | `readme3.md` |

---

## 19. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Widget not visible | OS 2.0 theme, script tag not injected | Add via Theme Editor or app block |
| `Store not found` on chat | Wrong domain, store disconnected | Use exact `*.myshopify.com`; reconnect OAuth |
| `REAUTH_REQUIRED` | Token revoked or Storefront 401 | Reconnect from dashboard |
| Intent always searches wrong thing | No `GROQ_API_KEY` | Set Groq key or rely on fallback keyword search |
| Sentiment 503 | Python service down | Start `python-service` or set `SENTIMENT_SERVICE_URL` |
| TTS fails with terms error | Groq Orpheus not accepted | Accept terms in Groq Console Playground |
| OAuth invalid callback | HMAC/secret mismatch | Check `SHOPIFY_CLIENT_SECRET` and callback URL in Partner dashboard |
| Webhook 401 | Wrong `SHOPIFY_WEBHOOK_SECRET` | Match Partner dashboard webhook secret |
| Encrypted token errors after deploy | `ENCRYPTION_KEY` changed | Keep stable key or reconnect all stores |
| Quota 429 | Plan limit hit | Upgrade plan or wait for monthly reset |

---

## Summary

ShopAssist is a **session-aware, stage-driven shopping agent**:

1. **Widget** on Shopify sends messages with a persistent `sessionToken`.
2. **Orchestrator** parses intent (rules + small LLM), calls **Shopify Storefront GraphQL** for catalog/cart, and advances **checkout collection**.
3. **Response agent** (larger LLM) turns structured results into natural language.
4. **PostgreSQL** holds store config, encrypted tokens, chat history, and context between turns.
5. **Optional voice and sentiment** layers use Groq and a Python sklearn service respectively.

For connection setup steps, see `readme3.md`. For a shorter architecture diagram, see `docs/SHOPIFY_AGENT_ARCHITECTURE.md`.
