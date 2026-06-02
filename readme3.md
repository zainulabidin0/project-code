# ShopAssist Store Connection Guide (`readme3`)

This guide explains exactly how to connect `project-2` (AddressFix ShopAssist) to a Shopify store, based on:
- `IMPLEMENTATION_PLAN.md`
- Current app implementation in `project-2` (`/api/shopify/*`, dashboard ShopAssist page, Shopify helpers)

---

## 1) What “Connect Store” Means

When you connect a store, the app performs Shopify OAuth and then:
1. Stores the shop in `shopify_stores` (linked to your project).
2. Saves encrypted Admin access token (`accessToken` encrypted with `ENCRYPTION_KEY`).
3. Registers `app/uninstalled` webhook (`/api/shopify/webhooks`).
4. Installs Shopify Script Tag pointing to your widget (`widget.js`) so chat appears on storefront.

---

## 2) Prerequisites

You must have:
- A Shopify Partner account and a development store.
- A Shopify app created in Partner dashboard.
- App running publicly (localhost alone is not enough for Shopify callback/webhooks).
- PostgreSQL configured and DB schema already pushed.

---

## 3) Required Environment Variables

Set these in `.env.local` (or production env):

```env
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_WEBHOOK_SECRET=...
ENCRYPTION_KEY=... # 32-byte hex recommended
NEXT_PUBLIC_APP_URL=https://your-public-app-url
NEXT_PUBLIC_WIDGET_URL=https://your-public-widget-url/widget.js
```

### Why each is needed
- `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`: OAuth handshake with Shopify.
- `SHOPIFY_WEBHOOK_SECRET`: verify webhook authenticity (`app/uninstalled`).
- `ENCRYPTION_KEY`: encrypt Shopify token before DB storage.
- `NEXT_PUBLIC_APP_URL`: builds callback/webhook URLs used by Shopify.
- `NEXT_PUBLIC_WIDGET_URL`: source of script tag injected into merchant storefront.

---

## 4) Shopify App Dashboard Configuration

In Shopify Partner app settings:

1. **App URL**  
   Set to your deployed app base URL (same as `NEXT_PUBLIC_APP_URL`).

2. **Allowed redirection URL(s)**  
   Add:
   - `https://your-public-app-url/api/shopify/callback`

3. **Webhook endpoint** (if manually configured)  
   - `https://your-public-app-url/api/shopify/webhooks`

4. **Scopes**  
   Ensure app has scopes used by code:
   - `read_products`
   - `write_script_tags`
   - `write_checkouts`

---

## 5) Run Commands (Local/Dev)

From `project-2`:

```bash
npm install
npm run db:push
npm run dev
```

If developing on localhost, expose app publicly (example):

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Then set `NEXT_PUBLIC_APP_URL` to tunnel URL and restart `npm run dev`.

### Why this order
- `npm install`: install Next.js + backend dependencies.
- `db:push`: ensure Shopify tables/columns exist before OAuth callback writes records.
- `dev`: start routes (`/api/shopify/install`, `/api/shopify/callback`, `/api/shopify/webhooks`).
- public tunnel: Shopify servers must reach callback and webhook endpoints.

---

## 6) Connect a Store from Dashboard (Actual User Flow)

1. Login to AddressFix dashboard.
2. Open project: `/projects/<projectId>/shopassist`.
3. In **Connect Shopify store**, enter:
   - `mystore.myshopify.com` (no `https://`)
4. Click **Install on Shopify**.
5. Shopify permission screen opens -> approve install.
6. Shopify redirects to `/api/shopify/callback`.
7. App stores connection and redirects back to:
   - `/projects/<projectId>/shopassist`

If successful, page shows store as connected.

---

## 7) Optional but Recommended: Add Storefront Token

On ShopAssist page you can save Storefront token:
- UI calls `POST /api/dashboard/shopassist/storefront-token`

Reason:
- App can run tokenless storefront access by default.
- Token improves reliability/features when tokenless storefront limits apply.

---

## 8) Verify Connection Works

### A) Store row created
Check dashboard status or DB:
- `shopify_stores.projectId` linked correctly
- `shopDomain` set
- `isActive = true`
- `authStatus = ACTIVE`

### B) Widget config endpoint works

```bash
curl "https://your-public-app-url/api/v1/shopify/widget-config?shop=mystore.myshopify.com"
```

Expected: `success: true` with position/color/greeting/storeName.

### C) Chat endpoint works

```bash
curl -X POST "https://your-public-app-url/api/v1/shopify/chat" \
  -H "Content-Type: application/json" \
  -H "X-Shop-Domain: mystore.myshopify.com" \
  -d "{\"message\":\"show me products\",\"sessionToken\":\"sess_test_12345\"}"
```

Expected: assistant reply payload with `success: true`.

### D) Storefront widget appears
Open merchant storefront and verify floating widget loads.

---

## 9) Reconnect and Uninstall Behavior

- If Shopify auth is revoked, app can set `authStatus = REAUTH_REQUIRED`.
- ShopAssist page shows **Reconnect Shopify store** button.
- On Shopify uninstall, webhook `/api/shopify/webhooks` marks:
  - `isActive = false`
  - `authStatus = UNINSTALLED`
  - `uninstalledAt = now`

---

## 10) Common Issues and Fixes

1. **“Invalid OAuth callback”**  
   - Recheck `SHOPIFY_CLIENT_SECRET`, callback URL, and query signature.

2. **Install succeeds but no widget on storefront**  
   - Verify `NEXT_PUBLIC_WIDGET_URL` points to real `widget.js`.
   - OS 2.0 themes may need manual app block/section placement.

3. **Webhook signature errors**  
   - Ensure `SHOPIFY_WEBHOOK_SECRET` matches Shopify app webhook secret exactly.

4. **Store not found on chat/widget-config**  
   - Shop domain mismatch (must be exact `*.myshopify.com`).
   - Store disconnected/inactive.

5. **Token decrypt/encrypt issues**  
   - Confirm stable `ENCRYPTION_KEY` (changing it invalidates previously stored tokens).

---

## 11) Quick Connection Checklist

- [ ] Set all required env vars.
- [ ] Configure Shopify app URL + callback URL.
- [ ] Run app with public URL.
- [ ] Open `/projects/<id>/shopassist`.
- [ ] Install with `mystore.myshopify.com`.
- [ ] Confirm connected status.
- [ ] Confirm widget appears on storefront.
- [ ] Test `/api/v1/shopify/chat`.

