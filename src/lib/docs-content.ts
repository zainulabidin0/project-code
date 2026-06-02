/** Shared copy, code samples, and nav metadata for /docs (no React). */

export type Framework = "html" | "react" | "nextjs";
export type DocNavItem = { id: string; label: string };

export const DEFAULT_API_BASE = "https://address-fix-six.vercel.app";

export function normalizeBase(url: string): string {
  return url.replace(/\/$/, "");
}

export const DOCS_NAV_ADDRESS: DocNavItem[] = [
  { id: "auth", label: "Authentication" },
  { id: "single", label: "Single correction" },
  { id: "batch", label: "Batch correction" },
  { id: "response", label: "Response" },
  { id: "errors", label: "Error codes" },
  { id: "rate-limits", label: "Rate limits" },
];

export const DOCS_NAV_REVIEWS: DocNavItem[] = [
  { id: "auth", label: "Authentication" },
  { id: "sentiment", label: "Sentiment" },
  { id: "sentiment-batch", label: "Sentiment batch" },
  { id: "reviews", label: "Reviews API" },
  { id: "public-reviews", label: "Public page" },
  { id: "response-sentiment", label: "Response" },
  { id: "errors", label: "Error codes" },
  { id: "rate-limits", label: "Rate limits" },
];

export const DOCS_NAV_SHOPIFY: DocNavItem[] = [
  { id: "auth", label: "Authentication" },
  { id: "install", label: "Install flow" },
  { id: "widget", label: "Widget embed" },
  { id: "chat", label: "Chat" },
  { id: "voice", label: "Voice" },
  { id: "cart", label: "Cart" },
  { id: "widget-config", label: "Widget config" },
  { id: "response-shopify", label: "Response" },
  { id: "errors", label: "Error codes" },
  { id: "rate-limits", label: "Rate limits" },
];

export const DOCS_ERROR_ROWS: [string, string, string][] = [
  ["INVALID_API_KEY", "401", "Key not found or malformed"],
  ["API_KEY_REVOKED", "403", "Key exists but was disabled"],
  ["API_KEY_EXPIRED", "403", "Key has passed its expiry date"],
  ["RATE_LIMIT_EXCEEDED", "429", "Per-minute limit hit"],
  ["QUOTA_EXCEEDED", "429", "Monthly quota reached"],
  ["INVALID_INPUT", "400", "Bad request body or missing fields"],
  ["ADDRESS_TOO_LONG", "400", "Address exceeds 1,000 characters"],
  [
    "BATCH_TOO_LARGE",
    "400",
    "More than 50 items in an address or sentiment batch",
  ],
  ["AI_UNAVAILABLE", "503", "Address AI (Groq) temporarily unavailable"],
  [
    "MODEL_UNAVAILABLE",
    "503",
    "Sentiment Python service failed or model not loaded",
  ],
  ["REVIEW_NOT_FOUND", "404", "Review id missing or not in project"],
  ["INTERNAL_ERROR", "500", "Unexpected server error"],
];

export const DOCS_PLAN_ROWS: [string, string, string, string][] = [
  ["Free", "500", "10", "1"],
  ["Starter", "10,000", "60", "5"],
  ["Pro", "100,000", "200", "20"],
  ["Enterprise", "Unlimited", "1,000", "∞"],
];

export function getAddressPrompt(
  fw: Framework,
  baseUrl: string = DEFAULT_API_BASE
): string {
  const api = normalizeBase(baseUrl);
  const base = `Build a realistic, production-ready address form that integrates with the AddressFix API to auto-correct addresses as users type or submit them.

API Details:
- Endpoint: ${api}/api/v1/correct
- Method: POST
- Auth: x-api-key header (value comes from environment variable, NEVER hardcoded)
- Request body: { "address": "user input here" }
- Success response: { "success": true, "data": { "original": "...", "corrected": "...", "confidence": 0.95, "correctionType": "AI_CORRECTED", "changes": ["list of changes"], "processingMs": 342 } }
- Error response: { "success": false, "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "...", "retryAfter": 45 } }

Core requirements:
1. Read the API key from an environment variable — NEVER hardcode it in source code
2. An address text input with a "Correct Address" button
3. On submit, call the API and show the corrected address below the input
4. Show a loading state (spinner or skeleton) while the request is in progress
5. If the address was changed, highlight the differences (before → after)
6. Display metadata: confidence score as a percentage, correction type badge, processing time
7. Show each individual change in a list (e.g. "BLk → Block (abbreviation)")
8. Handle errors gracefully — show user-friendly messages for: invalid API key (401), rate limit exceeded (429), server error (500)
9. Add a "Copy corrected address" button
10. Clean, modern UI design`;

  if (fw === "html") {
    return `${base}

Framework: Plain HTML, CSS, and JavaScript (no build tools, single index.html file).

Environment variable setup:
- Since plain HTML/JS runs in the browser and cannot read .env files, create a tiny backend proxy
- Create a file structure:
  /project
    index.html        ← the frontend
    server.js         ← a minimal Node.js/Express proxy server (or use a Cloudflare Worker)
    .env              ← contains ADDRESSFIX_API_KEY=af_live_xxxxx
    package.json
- The server.js should:
  - Load the API key from process.env.ADDRESSFIX_API_KEY using dotenv
  - Expose a POST /api/correct endpoint that the frontend calls
  - Proxy the request to ${api}/api/v1/correct with the API key attached server-side
  - Serve the index.html as a static file
- The index.html should:
  - Call the local /api/correct proxy (NOT the AddressFix API directly — that would expose the key)
  - Use fetch() with no API key in the frontend code
  - Be styled with clean, modern CSS (no frameworks)
  - Include a .env.example file with: ADDRESSFIX_API_KEY=your_api_key_here

This way the API key stays on the server and is never exposed to the browser.`;
  }

  if (fw === "react") {
    return `${base}

Framework: React (Vite + TypeScript).

Environment variable setup:
- Store the API key in .env as VITE_ADDRESSFIX_API_KEY=af_live_xxxxx
- Access it via import.meta.env.VITE_ADDRESSFIX_API_KEY
- Create a .env.example file with: VITE_ADDRESSFIX_API_KEY=your_api_key_here
- Add .env to .gitignore

IMPORTANT: Since Vite exposes VITE_ prefixed vars to the client bundle, for production you should proxy through your own backend. For this demo, using VITE_ env var is acceptable but add a comment warning about this.

Project structure:
/src
  /components
    AddressInput.tsx       ← main form component with input, button, results display
    CorrectionResult.tsx   ← shows corrected address, confidence badge, changes list
    ErrorMessage.tsx       ← user-friendly error display
  /hooks
    useAddressFix.ts       ← custom hook: { correct, result, isLoading, error }
  /lib
    addressfix.ts          ← API client that reads from env and makes the fetch call
  /types
    addressfix.ts          ← TypeScript interfaces for request/response
  App.tsx
  main.tsx
.env.example
.gitignore               ← must include .env

The useAddressFix hook should:
- Accept no arguments (reads API key from env internally via the lib client)
- Return { correct: (address: string) => Promise<void>, result, isLoading, error, reset }
- Handle all error states internally`;
  }

  return `${base}

Framework: Next.js 14+ (App Router, TypeScript).

Environment variable setup:
- Store the API key in .env.local as ADDRESSFIX_API_KEY=af_live_xxxxx (NO "NEXT_PUBLIC_" prefix — this must stay server-side only)
- Create a .env.example file with: ADDRESSFIX_API_KEY=your_api_key_here
- Add .env.local to .gitignore

Architecture (server action pattern — API key never reaches the client):
/app
  /actions
    correct-address.ts     ← "use server" — reads process.env.ADDRESSFIX_API_KEY, calls the API, returns result
  /components
    AddressForm.tsx         ← "use client" — form UI, calls the server action, displays results
    CorrectionResult.tsx    ← displays corrected address, confidence, changes
    ErrorMessage.tsx        ← user-friendly error display
  page.tsx                  ← imports and renders AddressForm
  layout.tsx
/lib
  addressfix.ts             ← server-only utility: makes the API call with the key from process.env
  types.ts                  ← shared TypeScript interfaces
.env.local
.env.example
.gitignore

The server action (correct-address.ts) should:
- Be marked with "use server"
- Read ADDRESSFIX_API_KEY from process.env (NOT from any client-accessible variable)
- Validate the input address before calling the API
- Return a typed result or throw a user-friendly error
- Never expose the API key in the response

The client component (AddressForm.tsx) should:
- Be marked with "use client"
- Import and call the server action directly
- Manage loading/error/result state with useState
- Use useTransition for the server action call to get isPending state`;
}

export function getSentimentPrompt(
  fw: Framework,
  baseUrl: string = DEFAULT_API_BASE
): string {
  const api = normalizeBase(baseUrl);
  const base = `Build a product review widget that calls the AddressFix Sentiment API to classify text and optionally display aggregate scores per project.

API details:
- Endpoint: ${api}/api/v1/sentiment
- Method: POST
- Auth: x-api-key (same key as address correction — one key per project)
- Request: { "review": "text", "reviewerName": "optional", "reviewerMeta": { "email": "...", "avatarUrl": "..." } }
- Success: { "success": true, "data": { "id", "review", "sentiment": "POSITIVE"|"NEGATIVE", "score": 1|-1, "confidence": 0-100, "projectNetScore": number, "processingMs" } }
- Each successful call stores the review; projectNetScore is the sum of +1 / -1 for all reviews in the project
- Error shape: { "success": false, "error": { "code", "message", "retryAfter"?: number } }
- For multiple reviews: POST ${api}/api/v1/sentiment/batch with { "reviews": [ { "review", "reviewerName?" }, ... ] } (max 50)
- To list stored reviews: GET ${api}/api/v1/reviews?limit=20&offset=0 (same x-api-key)
- Stats: GET ${api}/api/v1/reviews/stats

Requirements:
1. API key from environment — never hardcode
2. Text area + submit, loading state, show sentiment badge and confidence
3. Show projectNetScore if returned
4. Handle 401, 429, 503 (MODEL_UNAVAILABLE) with clear messages
5. Optional: batch form for 2+ reviews
6. Clean, accessible UI`;

  if (fw === "html") {
    return `${base}

Framework: Plain HTML/JS. Use a small Node proxy to hide the key (same pattern as address correction), or document that the demo key must be server-proxied.`;
  }
  if (fw === "react") {
    return `${base}

Framework: React. Store key in VITE_ or use a dev-only key with a strong warning, or a backend proxy.`;
  }
  return `${base}

Framework: Next.js. Prefer a Server Action that calls the API with process.env.ADDRESSFIX_API_KEY so the key stays server-only.`;
}

export function buildSingleCorrectSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `<!-- index.html -->
<script>
async function correctAddress(address) {
  const res = await fetch(
    "${api}/api/v1/correct",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "af_live_xxxxxxxxxxxx",
      },
      body: JSON.stringify({ address }),
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.error.message);
  return json.data;
}

// Usage
correctAddress("house 5, BLk C, mdl town, lahore")
  .then((d) => console.log(d.corrected));
</script>`,
    react: `// hooks/useAddressFix.ts
import { useState, useCallback } from "react";

const API = "${api}/api/v1/correct";

export function useAddressFix(apiKey: string) {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correct = useCallback(
    async (address: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ address }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error.message);
        return json.data;
      } catch (e: any) {
        setError(e.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiKey]
  );

  return { correct, isLoading, error };
}`,
    nextjs: `// app/actions/correct-address.ts
"use server";

export async function correctAddress(address: string) {
  const res = await fetch(
    "${api}/api/v1/correct",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ADDRESSFIX_API_KEY!,
      },
      body: JSON.stringify({ address }),
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.error.message);
  return json.data;
}`,
  };
}

export function buildBatchSnippets(api: string): Record<Framework, string> {
  return {
    html: `// Batch correction — plain JS
async function correctBatch(addresses) {
  const res = await fetch(
    "${api}/api/v1/correct/batch",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "af_live_xxxxxxxxxxxx",
      },
      body: JSON.stringify({ addresses }),
    }
  );
  return (await res.json()).data;
}

correctBatch([
  "apt 4B, elm strt, chicago",
  "123 main st, new yrok, NY 10001",
]).then(console.log);`,
    react: `// components/BatchCorrect.tsx
import { useAddressFix } from "../hooks/useAddressFix";

export function BatchCorrect({ apiKey }: { apiKey: string }) {
  const { correct, isLoading } = useAddressFix(apiKey);
  
  async function handleBatch(addresses: string[]) {
    const res = await fetch(
      "${api}/api/v1/correct/batch",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ addresses }),
      }
    );
    return (await res.json()).data;
  }

  // render your UI here
}`,
    nextjs: `// app/actions/correct-batch.ts
"use server";

export async function correctBatch(addresses: string[]) {
  const res = await fetch(
    "${api}/api/v1/correct/batch",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ADDRESSFIX_API_KEY!,
      },
      body: JSON.stringify({ addresses }),
    }
  );
  const json = await res.json();
  if (!json.success) throw new Error(json.error.message);
  return json.data;
}`,
  };
}

export function buildSentimentSingleSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `<!-- index.html / browser → use a server proxy; example shows direct for curl-style clarity -->
<script>
async function analyzeReview(text, key) {
  const res = await fetch("${api}/api/v1/sentiment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      review: text,
      reviewerName: "Jane",
      reviewerMeta: { email: "jane@example.com" },
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data;
}
</script>`,
    react: `// Example: call from React (use server proxy in production for the key)
const API = "${api}/api/v1/sentiment";

export async function submitSentiment(apiKey: string, review: string) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ review }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data;
}`,
    nextjs: `// app/actions/sentiment.ts
"use server";

export async function runSentiment(review: string) {
  const res = await fetch("${api}/api/v1/sentiment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ADDRESSFIX_API_KEY!,
    },
    body: JSON.stringify({ review }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data;
}`,
  };
}

export function buildSentimentBatchSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `async function sentimentBatch(reviews, key) {
  const res = await fetch("${api}/api/v1/sentiment/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      reviews: reviews.map((r) =>
        typeof r === "string" ? { review: r } : r
      ),
    }),
  });
  return (await res.json()).data;
}`,
    react: `const BATCH = "${api}/api/v1/sentiment/batch";

// body.reviews: { review, reviewerName? }[]  — max 50
export async function batchSentiment(
  apiKey: string,
  items: { review: string; reviewerName?: string }[]
) {
  const res = await fetch(BATCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ reviews: items }),
  });
  return (await res.json()).data;
}`,
    nextjs: `"use server";

export async function batchSentiment(
  items: { review: string; reviewerName?: string }[]
) {
  const res = await fetch("${api}/api/v1/sentiment/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ADDRESSFIX_API_KEY!,
    },
    body: JSON.stringify({ reviews: items }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data;
}`,
  };
}

export function getShopifyPrompt(
  fw: Framework,
  baseUrl: string = DEFAULT_API_BASE
): string {
  const api = normalizeBase(baseUrl);
  const base = `Build a Shopify storefront experience that uses the AddressFix ShopAssist API to power an AI shopping widget (chat + voice) on a merchant's store.

API details:
- Base: ${api}
- Auth: header "X-Shop-Domain: <store>.myshopify.com" (NO x-api-key on the client — the shop domain is validated server-side against the registered store).
- Anonymous session: client generates a random sessionToken, stores it in localStorage, sends it on every request.
- Endpoints:
  - GET ${api}/api/v1/shopify/widget-config?shop=<domain>          → widget settings (color, position, greeting, storeName).
  - POST ${api}/api/v1/shopify/chat                                → { message, sessionToken } → reply + products[].
  - POST ${api}/api/v1/shopify/voice                               → multipart/form-data with field "audio" → { transcript }.
  - POST ${api}/api/v1/shopify/cart                                → { sessionToken, variantId, quantity } → { cartId, checkoutUrl }.
- All responses are { success, data | error } with CORS allowed for any origin.

Requirements:
1. Floating button that opens a chat panel (mic + text input).
2. On load, GET widget-config and apply position/color/greeting.
3. On send, POST chat and render the assistant message + product cards (image, title, price, "Add to Cart").
4. On mic press, record audio, POST to /voice, then forward transcript to /chat.
5. On "Add to Cart", POST /cart and link to checkoutUrl.
6. Persist sessionToken in localStorage.
7. No API key in the browser — only X-Shop-Domain header.`;

  if (fw === "html") {
    return `${base}

Framework: Plain HTML / CSS / JS, embedded as a single <script> tag on the merchant's storefront. No build tools.`;
  }
  if (fw === "react") {
    return `${base}

Framework: React component (Vite + TypeScript) consumed by a custom Shopify theme app extension. Use a small ShopAssist provider that exposes useChat, useCart, useVoice hooks.`;
  }
  return `${base}

Framework: Next.js admin dashboard page that renders the same widget as a preview, plus a server action that proxies the chat call when staff test the assistant.`;
}

export function buildShopifyWidgetSnippets(api: string): {
  embed: string;
  widgetConfig: string;
} {
  return {
    embed: `<!-- Place once at the bottom of your Shopify theme.liquid -->
<script
  src="${api}/widget.js"
  data-shop="{{ shop.permanent_domain }}"
  async
></script>`,
    widgetConfig: `// Browser
const res = await fetch(
  "${api}/api/v1/shopify/widget-config?shop=mystore.myshopify.com"
);
const { data } = await res.json();
// data: { position, color, greeting, storeName }`,
  };
}

export function buildShopifyChatSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `<!-- Browser — no API key, just X-Shop-Domain header -->
<script>
async function sendMessage(text) {
  const sessionToken =
    localStorage.getItem("af_shop_session") ||
    "sess_" + Math.random().toString(36).slice(2);
  localStorage.setItem("af_shop_session", sessionToken);

  const res = await fetch("${api}/api/v1/shopify/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": "mystore.myshopify.com",
    },
    body: JSON.stringify({ message: text, sessionToken }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error.message);
  return json.data; // { message, intent, products, needsClarification?, suggestions?, sessionToken }
}
</script>`,
    react: `// React (browser-safe — no API key required)
const API = "${api}/api/v1/shopify";

export async function sendChat(shop: string, message: string) {
  const sessionToken =
    localStorage.getItem("af_shop_session") ??
    "sess_" + Math.random().toString(36).slice(2);
  localStorage.setItem("af_shop_session", sessionToken);

  const res = await fetch(API + "/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": shop,
    },
    body: JSON.stringify({ message, sessionToken }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data; // supports clarification payload: needsClarification + suggestions
}`,
    nextjs: `// app/actions/shop-chat.ts
"use server";

export async function shopChat(shop: string, message: string, sessionToken: string) {
  const res = await fetch("${api}/api/v1/shopify/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": shop,
    },
    body: JSON.stringify({ message, sessionToken }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data; // supports clarification payload: needsClarification + suggestions
}`,
  };
}

export function buildShopifyVoiceSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `// Browser — record + transcribe
async function transcribe(blob, shop) {
  const form = new FormData();
  form.append("audio", blob, "voice.webm");
  const res = await fetch("${api}/api/v1/shopify/voice", {
    method: "POST",
    headers: { "X-Shop-Domain": shop },
    body: form,
  });
  return (await res.json()).data.transcript;
}`,
    react: `export async function transcribe(blob: Blob, shop: string) {
  const form = new FormData();
  form.append("audio", blob, "voice.webm");
  const res = await fetch("${api}/api/v1/shopify/voice", {
    method: "POST",
    headers: { "X-Shop-Domain": shop },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data.transcript as string;
}`,
    nextjs: `// app/actions/shop-voice.ts
"use server";

export async function transcribeAudio(shop: string, file: File) {
  const form = new FormData();
  form.append("audio", file);
  const res = await fetch("${api}/api/v1/shopify/voice", {
    method: "POST",
    headers: { "X-Shop-Domain": shop },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data.transcript as string;
}`,
  };
}

export function buildShopifyCartSnippets(
  api: string
): Record<Framework, string> {
  return {
    html: `<script>
async function addToCart(variantId, shop) {
  const sessionToken = localStorage.getItem("af_shop_session");
  const res = await fetch("${api}/api/v1/shopify/cart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": shop,
    },
    body: JSON.stringify({ sessionToken, variantId, quantity: 1 }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  window.location.href = json.data.checkoutUrl;
}
</script>`,
    react: `export async function addToCart(
  shop: string,
  variantId: string,
  sessionToken: string,
  quantity = 1
) {
  const res = await fetch("${api}/api/v1/shopify/cart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": shop,
    },
    body: JSON.stringify({ sessionToken, variantId, quantity }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data; // { cartId, checkoutUrl }
}`,
    nextjs: `// app/actions/shop-cart.ts
"use server";

export async function shopAddToCart(
  shop: string,
  sessionToken: string,
  variantId: string,
  quantity: number = 1
) {
  const res = await fetch("${api}/api/v1/shopify/cart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Domain": shop,
    },
    body: JSON.stringify({ sessionToken, variantId, quantity }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message);
  return json.data;
}`,
  };
}

export function buildReviewsSnippets(api: string): {
  list: string;
  stats: string;
  curl: string;
  php: string;
} {
  return {
    list: `// GET /api/v1/reviews?limit=20&offset=0
const res = await fetch(
  "${api}/api/v1/reviews?limit=20&offset=0",
  { headers: { "x-api-key": key } }
);
const { data } = await res.json();
// data.reviews, data.total, data.limit, data.offset`,

    stats: `const res = await fetch("${api}/api/v1/reviews/stats", {
  headers: { "x-api-key": key },
});
// data: { total, positive, negative, netScore }`,

    curl: `curl -sS -X GET "${api}/api/v1/reviews?limit=10" \\
  -H "x-api-key: af_live_xxxxxxxxxxxx"

curl -sS -X GET "${api}/api/v1/reviews/stats" \\
  -H "x-api-key: af_live_xxxxxxxxxxxx"

curl -sS -X DELETE "${api}/api/v1/reviews/REVIEW_ID" \\
  -H "x-api-key: af_live_xxxxxxxxxxxx"`,

    php: `<?php
$ctx = stream_context_create([
  'http' => [
    'method' => 'GET',
    'header' => "x-api-key: af_live_xxx\\r\\n",
  ],
]);
$json = file_get_contents('${api}/api/v1/reviews?limit=20', false, $ctx);
$data = json_decode($json, true)['data'];`,
  };
}
