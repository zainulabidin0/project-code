# ShopAssist — Phase 2: Conversational Checkout with URL Prefill

## Goal

When the user says "checkout" / "let's go" / "place order":
1. Agent collects their details conversationally (name, email, phone, address)
2. Agent builds a prefilled Shopify checkout URL
3. Widget shows **"Complete Order →"** button that opens the prefilled checkout page
4. User lands on Shopify checkout with ALL fields already filled in — just tap "Pay"

---

## The Checkout URL Structure

Shopify supports prefilling checkout via query parameters on the checkout URL.

### Format
```
{baseCheckoutUrl}
  ?checkout[email]={email}
  &checkout[shipping_address][first_name]={firstName}
  &checkout[shipping_address][last_name]={lastName}
  &checkout[shipping_address][phone]={phone}
  &checkout[shipping_address][address1]={address1}
  &checkout[shipping_address][city]={city}
  &checkout[shipping_address][province]={province}
  &checkout[shipping_address][zip]={zip}
  &checkout[shipping_address][country]={country}
```

### Real Example
```
https://my-cart-10001.myshopify.com/checkouts/cn/hWND4oVlkI3PmqJOaaLRrW0Q/en-pk
  ?checkout[email]=ali@gmail.com
  &checkout[shipping_address][first_name]=Ali
  &checkout[shipping_address][last_name]=Khan
  &checkout[shipping_address][phone]=+923001234567
  &checkout[shipping_address][address1]=House+5+Block+A+Gulshan
  &checkout[shipping_address][city]=Karachi
  &checkout[shipping_address][zip]=75500
  &checkout[shipping_address][country]=PK
```

### Notes
- `baseCheckoutUrl` comes from Shopify cart's `checkoutUrl` field (already in your cart response)
- Country default: `PK` (Pakistan)
- Phone format: `+92XXXXXXXXXX`
- Name is split into `first_name` and `last_name` from the collected `fullName`
- `province` is optional but recommended (Shopify may auto-fill from city)

---

## What Changes in Phase 2

| Area | Change |
|------|--------|
| `gpt-agent.ts` | Replace `complete_checkout` tool with `build_checkout_url` tool |
| `storefront.ts` | Add `getCartCheckoutUrl()` if not present — just reads cart's checkoutUrl |
| `checkout-url-builder.ts` | **New file** — builds the prefilled URL |
| `chat/route.ts` | Return `checkoutUrl` in response so widget can show button |
| `widget.js` | Show "Complete Order →" button that opens the prefilled URL in new tab |
| Session context | Store `checkoutUrl` once built so it persists |

---

## New File: `src/lib/shopify/checkout-url-builder.ts`

```typescript
// src/lib/shopify/checkout-url-builder.ts

export interface CheckoutDraft {
  fullName?: string;       // "Ali Khan"
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;        // default "PK"
}

/**
 * Split "Ali Khan" → { firstName: "Ali", lastName: "Khan" }
 * "Ali" only → { firstName: "Ali", lastName: "" }
 * "Ali Hassan Khan" → { firstName: "Ali", lastName: "Hassan Khan" }
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Normalize Pakistani phone numbers to +92XXXXXXXXXX format
 * Accepts: 03001234567, 3001234567, +923001234567, 00923001234567
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.length === 10) return `+92${digits}`;
  return `+${digits}`; // fallback — send as-is with +
}

/**
 * Map Pakistani city names to province codes
 */
const CITY_TO_PROVINCE: Record<string, string> = {
  karachi: "SD",        // Sindh
  hyderabad: "SD",
  sukkur: "SD",
  lahore: "PB",         // Punjab
  faisalabad: "PB",
  rawalpindi: "PB",
  multan: "PB",
  gujranwala: "PB",
  sialkot: "PB",
  islamabad: "IS",      // Islamabad Capital Territory
  peshawar: "KP",       // Khyber Pakhtunkhwa
  mardan: "KP",
  quetta: "BA",         // Balochistan
  abbottabad: "KP",
  murree: "PB",
};

function inferProvince(city: string, explicitProvince?: string): string {
  if (explicitProvince) return explicitProvince;
  return CITY_TO_PROVINCE[city.toLowerCase()] ?? "";
}

/**
 * Build the prefilled Shopify checkout URL
 * baseUrl: the checkoutUrl from Shopify cart (e.g. https://store.myshopify.com/checkouts/cn/xxx)
 */
export function buildCheckoutUrl(baseUrl: string, draft: CheckoutDraft): string {
  if (!baseUrl) throw new Error("No checkout URL available — cart may be empty");

  const { firstName, lastName } = splitName(draft.fullName ?? "");
  const phone = draft.phone ? normalizePhone(draft.phone) : "";
  const province = inferProvince(draft.city ?? "", draft.province);
  const country = draft.country ?? "PK";

  const params = new URLSearchParams();

  if (draft.email)    params.set("checkout[email]", draft.email);
  if (firstName)      params.set("checkout[shipping_address][first_name]", firstName);
  if (lastName)       params.set("checkout[shipping_address][last_name]", lastName);
  if (phone)          params.set("checkout[shipping_address][phone]", phone);
  if (draft.address1) params.set("checkout[shipping_address][address1]", draft.address1);
  if (draft.address2) params.set("checkout[shipping_address][address2]", draft.address2);
  if (draft.city)     params.set("checkout[shipping_address][city]", draft.city);
  if (province)       params.set("checkout[shipping_address][province]", province);
  if (draft.zip)      params.set("checkout[shipping_address][zip]", draft.zip);
  params.set("checkout[shipping_address][country]", country);

  // Shopify checkout URLs may already have query params — handle both cases
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${params.toString()}`;
}

/**
 * Check which required fields are still missing
 */
export function getMissingFields(draft: CheckoutDraft): string[] {
  const required: (keyof CheckoutDraft)[] = [
    "fullName", "email", "phone", "address1", "city", "zip"
  ];
  return required.filter(f => !draft[f]?.trim());
}

/**
 * Human-readable prompts for each missing field
 */
export const FIELD_PROMPTS: Record<string, string> = {
  fullName:  "What's your full name?",
  email:     "What's your email address?",
  phone:     "What's your phone number?",
  address1:  "What's your street address?",
  address2:  "Apartment/floor number? (or say 'skip')",
  city:      "Which city?",
  zip:       "What's your postal/zip code?",
};
```

---

## Updated Tool: `build_checkout_url` (replaces `complete_checkout`)

Add this tool to the tools array in `gpt-agent.ts`:

```typescript
{
  type: "function",
  function: {
    name: "build_checkout_url",
    description: `Build the final prefilled checkout URL and mark order as ready.
    Call this ONLY when you have collected ALL required fields:
    fullName, email, phone, address1, city, zip.
    address2 is optional. province is auto-inferred from city for Pakistan.`,
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
}
```

### Implementation in `executeTool()`:

```typescript
case "build_checkout_url": {
  // Validate all required fields present
  const missing = getMissingFields(context.checkoutDraft);
  if (missing.length > 0) {
    return {
      result: {
        success: false,
        missing,
        message: `Still need: ${missing.join(", ")}`
      },
      contextUpdates: {}
    };
  }

  // Get the base checkout URL from Shopify cart
  const cart = await getCartCheckoutUrl(context.storefrontStore, context.cartId);
  if (!cart?.checkoutUrl) {
    return {
      result: { success: false, message: "Cart is empty or checkout URL unavailable" },
      contextUpdates: {}
    };
  }

  // Build the prefilled URL
  const prefilled = buildCheckoutUrl(cart.checkoutUrl, context.checkoutDraft);

  const contextUpdates = {
    checkoutReady: true,
    cartAction: {
      checkoutUrl: prefilled,
      totalPrice: cart.totalPrice,
    }
  };

  return {
    result: {
      success: true,
      checkoutUrl: prefilled,
      totalPrice: cart.totalPrice,
      message: "Checkout URL ready"
    },
    contextUpdates
  };
}
```

---

## Updated System Prompt Section (checkout part)

Replace the checkout section in `buildSystemPrompt()` in `gpt-agent.ts`:

```
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
```

---

## Updated `chat/route.ts` Response

Ensure the route returns `checkoutUrl` properly:

```typescript
return Response.json({
  success: true,
  data: {
    message: result.reply,
    products: result.products ?? [],
    cartAction: result.cartAction,        // { checkoutUrl, totalPrice }
    checkoutReady: result.checkoutReady,
    checkoutUrl: result.cartAction?.checkoutUrl ?? null,  // explicit for widget
    sessionToken,
  }
});
```

---

## Widget Changes (`public/widget.js`)

### Show "Complete Order" button

```javascript
function handleResponse(response) {
  if (!response.success) {
    appendMessage("assistant", response.data?.message ?? "Something went wrong.");
    return;
  }

  const data = response.data;
  clearProductCards();

  if (data.message) {
    appendMessage("assistant", data.message);
  }

  if (data.products?.length > 0) {
    renderProductCards(data.products);
  }

  // Show checkout button when ready
  if (data.checkoutReady && data.checkoutUrl) {
    showCheckoutButton(data.checkoutUrl, data.cartAction?.totalPrice);
  } else {
    hideCheckoutButton();
  }
}

function showCheckoutButton(url, totalPrice) {
  // Remove existing button first
  hideCheckoutButton();

  const btn = document.createElement("a");
  btn.id = "af-checkout-btn";
  btn.href = url;
  btn.target = "_blank";
  btn.rel = "noopener noreferrer";
  btn.className = "af-checkout-button";
  btn.innerHTML = `
    <span>Complete Order →</span>
    ${totalPrice ? `<small>${totalPrice}</small>` : ""}
  `;

  // Style the button
  btn.style.cssText = `
    display: block;
    background: #000;
    color: #fff;
    text-align: center;
    padding: 14px 20px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    font-size: 15px;
    margin: 12px 8px 4px;
    cursor: pointer;
  `;

  chatContainer.appendChild(btn);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideCheckoutButton() {
  document.getElementById("af-checkout-btn")?.remove();
}
```

---

## Full Conversation Example

```
User:  "Let's checkout"
Agent: get_cart() → 2x Wireless Charger PKR 2398
Agent: "You have 2x Wireless Charger (PKR 2,398 total). 
        Let's set up delivery. What's your full name?"

User:  "Ali Khan"
Agent: save_checkout_info(fullName, "Ali Khan")
Agent: "What's your email address?"

User:  "ali@gmail.com"
Agent: save_checkout_info(email, "ali@gmail.com")
       lookup_saved_address("ali@gmail.com") → not found
Agent: "What's your phone number?"

User:  "03001234567"
Agent: save_checkout_info(phone, "03001234567")
Agent: "What's your street address?"

User:  "House 5, Block A, Gulshan"
Agent: save_checkout_info(address1, "House 5, Block A, Gulshan")
Agent: "Which city?"

User:  "Karachi"
Agent: save_checkout_info(city, "Karachi")
Agent: "Zip/postal code?"

User:  "75500"
Agent: save_checkout_info(zip, "75500")
       build_checkout_url()
       → builds: https://store.myshopify.com/checkouts/cn/xxx
           ?checkout[email]=ali@gmail.com
           &checkout[shipping_address][first_name]=Ali
           &checkout[shipping_address][last_name]=Khan
           &checkout[shipping_address][phone]=+923001234567
           &checkout[shipping_address][address1]=House+5+Block+A+Gulshan
           &checkout[shipping_address][city]=Karachi
           &checkout[shipping_address][province]=SD
           &checkout[shipping_address][zip]=75500
           &checkout[shipping_address][country]=PK

Agent: "All set Ali! Tap below to complete your order 🎉"
       [Complete Order → PKR 2,398 button appears]

User clicks button → Shopify checkout opens with ALL fields pre-filled → just tap Pay
```

---

## Returning Customer Example (fast path)

```
User:  "Checkout"
Agent: get_cart() → items found
Agent: "What's your full name?"

User:  "Ali Khan"
Agent: save_checkout_info(fullName, "Ali Khan")
Agent: "Email?"

User:  "ali@gmail.com"
Agent: save_checkout_info(email, "ali@gmail.com")
       lookup_saved_address("ali@gmail.com") → FOUND
       → address: House 5, Block A, Gulshan, Karachi, 75500

Agent: "I have your saved address:
        House 5, Block A, Gulshan, Karachi 75500.
        Use this? Just confirm your phone number."

User:  "Yes, 03001234567"
Agent: save_checkout_info(phone, "03001234567")
       apply_saved_address("ali@gmail.com")
       build_checkout_url()

Agent: "Done! Tap below to complete your order 🎉"
       [Complete Order → button appears]
```

---

## Cursor Implementation Checklist

### New files
- [ ] Create `src/lib/shopify/checkout-url-builder.ts` with `buildCheckoutUrl()`, `getMissingFields()`, `splitName()`, `normalizePhone()`, `CITY_TO_PROVINCE` map

### `gpt-agent.ts` changes
- [ ] Remove `complete_checkout` tool, add `build_checkout_url` tool
- [ ] Add `build_checkout_url` case to `executeTool()`
- [ ] Import `buildCheckoutUrl`, `getMissingFields` from `checkout-url-builder.ts`
- [ ] Update system prompt checkout section (use the new version above)

### `storefront.ts` changes
- [ ] Ensure `getCartCheckoutUrl(storefrontStore, cartId)` exists and returns `{ checkoutUrl, totalPrice }`
- [ ] If it doesn't exist, add it — it just queries the Shopify cart for `checkoutUrl` and `cost.totalAmount`

### `chat/route.ts` changes
- [ ] Add `checkoutUrl: result.cartAction?.checkoutUrl ?? null` to response body

### `widget.js` changes
- [ ] Add `showCheckoutButton(url, totalPrice)` function
- [ ] Add `hideCheckoutButton()` function
- [ ] Call `showCheckoutButton` when `data.checkoutReady && data.checkoutUrl`
- [ ] Call `hideCheckoutButton` on every new response before re-evaluating
- [ ] Button opens URL in `_blank` tab

### Test cases
- [ ] Full checkout flow from "checkout" to button appearing
- [ ] Prefilled URL contains all fields correctly encoded
- [ ] Phone `03001234567` → `+923001234567` in URL
- [ ] Name `Ali Khan` → `first_name=Ali&last_name=Khan`
- [ ] City `Karachi` → `province=SD` auto-inferred
- [ ] Returning customer — saved address skips address fields
- [ ] Empty cart → agent says "add items first" instead of starting checkout
- [ ] Button click → Shopify checkout opens with fields pre-filled