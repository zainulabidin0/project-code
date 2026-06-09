export type CheckoutField =
  | "fullName"
  | "email"
  | "phone"
  | "address1"
  | "address2"
  | "city"
  | "province"
  | "zip";

export type CheckoutDraft = {
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  countryCode?: string;
};

export const DEFAULT_COUNTRY_CODE = "PK";

const CHECKOUT_FIELD_ORDER: CheckoutField[] = [
  "fullName",
  "email",
  "phone",
  "address1",
  "address2",
  "city",
  "province",
  "zip",
];

export const CHECKOUT_STEP_COUNT = CHECKOUT_FIELD_ORDER.length;

function fieldStep(field: CheckoutField): number {
  return CHECKOUT_FIELD_ORDER.indexOf(field) + 1;
}

export function isCheckoutIntent(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\b(checkout|check out|pay now|make payment|place order|complete order|finish order|proceed to pay|proceed to payment|want to pay|ready to pay|bill|payment|order confirm|checkout kr|payment kr|pay kr|order krna|ab pay|ab checkout)\b/i.test(
    text
  );
}

const PK_PROVINCE_CODES: Record<string, string> = {
  punjab: "PB",
  pb: "PB",
  sindh: "SD",
  sd: "SD",
  "khyber pakhtunkhwa": "KP",
  kpk: "KP",
  kp: "KP",
  balochistan: "BA",
  ba: "BA",
  "islamabad": "IS",
  "islamabad capital territory": "IS",
  is: "IS",
  ict: "IS",
  gilgit: "GB",
  "gilgit-baltistan": "GB",
  gb: "GB",
  ajk: "JK",
  "azad kashmir": "JK",
  jk: "JK",
};

export function createInitialCheckoutDraft(): CheckoutDraft {
  return { countryCode: DEFAULT_COUNTRY_CODE };
}

export function getNextCheckoutField(draft: CheckoutDraft): CheckoutField | null {
  for (const field of CHECKOUT_FIELD_ORDER) {
    if (field === "address2") {
      if (draft.address2 === undefined) return field;
      continue;
    }
    if (!draft[field]) return field;
  }
  return null;
}

export function getCheckoutQuestion(field: CheckoutField): string {
  const step = fieldStep(field);
  const stepLabel = `Step ${step} of ${CHECKOUT_STEP_COUNT}`;

  switch (field) {
    case "fullName":
      return `${stepLabel} — What is your full name for delivery?\n(e.g. Ali Khan)`;
    case "email":
      return `${stepLabel} — What email should we send your order confirmation to?\n(e.g. ali@gmail.com)`;
    case "phone":
      return `${stepLabel} — What phone number can the courier call?\n(e.g. 0300-1234567)`;
    case "address1":
      return `${stepLabel} — What is your delivery address?\n(House/plot number and street name)`;
    case "address2":
      return `${stepLabel} — Any apartment, floor, or nearby landmark?\n(Reply skip if not needed)`;
    case "city":
      return `${stepLabel} — Which city should we deliver to?\n(e.g. Lahore, Karachi)`;
    case "province":
      return `${stepLabel} — Which province?\n(e.g. Punjab, Sindh, KPK)`;
    case "zip":
      return `${stepLabel} — What is your postal code?\n(e.g. 54000)`;
    default:
      return "Please share the next delivery detail.";
  }
}

export function buildCheckoutStartMessage(cartTotal?: string): string {
  const totalLine = cartTotal ? `\nYour cart total: ${cartTotal}` : "";
  return `Sure — I'll help you checkout!${totalLine}\n\nI'll ask ${CHECKOUT_STEP_COUNT} quick delivery questions. Just reply to each message one by one.\n\n${getCheckoutQuestion("fullName")}`;
}

export function buildCartAddedCheckoutIntro(cartTotal?: string): string {
  const totalLine = cartTotal ? `\nCart total: ${cartTotal}` : "";
  return `Added to your cart!${totalLine}\n\nBefore checkout, I need your delivery details. I'll ask ${CHECKOUT_STEP_COUNT} short questions — reply to each one.\n\n${getCheckoutQuestion("fullName")}`;
}

export function buildCheckoutReadyMessage(): string {
  return "All set! Your delivery details are saved.\n\nTap the Complete order button below to open checkout — your name and address will already be filled in.";
}

export function buildCheckoutResumeMessage(field: CheckoutField): string {
  return `Let's continue checkout.\n\n${getCheckoutQuestion(field)}`;
}

export function buildEmptyCartCheckoutMessage(): string {
  return "Your cart is empty right now. Tell me what you'd like to buy and I'll add it for you first.";
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Customer", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normalizeProvinceCode(province: string): string {
  const key = province.trim().toLowerCase();
  return PK_PROVINCE_CODES[key] ?? province.trim().slice(0, 8).toUpperCase();
}

export function parseCheckoutAnswer(
  field: CheckoutField,
  message: string
): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, reason: "Please type a reply so I can continue." };
  }

  if (field === "address2") {
    if (/^(skip|none|no|n\/a|na|-)$/i.test(trimmed)) {
      return { ok: true, value: "" };
    }
    return { ok: true, value: trimmed };
  }

  if (field === "email") {
    const email = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, reason: "That doesn't look like a valid email. Please try again." };
    }
    return { ok: true, value: email };
  }

  if (field === "phone") {
    const digits = trimmed.replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length < 7) {
      return { ok: false, reason: "Please enter a valid phone number." };
    }
    return { ok: true, value: trimmed };
  }

  if (field === "fullName") {
    if (trimmed.length < 2) {
      return { ok: false, reason: "Please enter your full name." };
    }
    return { ok: true, value: trimmed };
  }

  if (field === "zip") {
    if (trimmed.length < 3) {
      return { ok: false, reason: "Please enter a valid postal code." };
    }
    return { ok: true, value: trimmed };
  }

  return { ok: true, value: trimmed };
}

export function applyCheckoutAnswer(
  draft: CheckoutDraft,
  field: CheckoutField,
  value: string
): CheckoutDraft {
  const next = { ...draft };
  if (field === "address2") {
    next.address2 = value;
    return next;
  }
  next[field] = value;
  return next;
}

export function isCheckoutDraftComplete(draft: CheckoutDraft): boolean {
  return getNextCheckoutField(draft) === null;
}

export type CheckoutStepResult =
  | {
      status: "next";
      draft: CheckoutDraft;
      field: CheckoutField;
      message: string;
    }
  | {
      status: "invalid";
      draft: CheckoutDraft;
      field: CheckoutField;
      message: string;
    }
  | {
      status: "complete";
      draft: CheckoutDraft;
      message: string;
    };

export function processCheckoutAnswer(
  draft: CheckoutDraft,
  field: CheckoutField,
  message: string
): CheckoutStepResult {
  const parsed = parseCheckoutAnswer(field, message);
  if (!parsed.ok) {
    return {
      status: "invalid",
      draft,
      field,
      message: `${parsed.reason}\n\n${getCheckoutQuestion(field)}`,
    };
  }

  const updated = applyCheckoutAnswer(draft, field, parsed.value);
  const nextField = getNextCheckoutField(updated);
  if (!nextField) {
    return {
      status: "complete",
      draft: updated,
      message: buildCheckoutReadyMessage(),
    };
  }

  const ack = field === "fullName" ? "Thanks!" : "Got it!";
  return {
    status: "next",
    draft: updated,
    field: nextField,
    message: `${ack}\n\n${getCheckoutQuestion(nextField)}`,
  };
}

export function beginCheckoutCollection(cartTotal?: string): {
  draft: CheckoutDraft;
  field: CheckoutField;
  message: string;
} {
  const draft = createInitialCheckoutDraft();
  const field = getNextCheckoutField(draft)!;
  return {
    draft,
    field,
    message: buildCartAddedCheckoutIntro(cartTotal),
  };
}

export function beginCheckoutFromExistingCart(cartTotal?: string): {
  draft: CheckoutDraft;
  field: CheckoutField;
  message: string;
} {
  const draft = createInitialCheckoutDraft();
  const field = getNextCheckoutField(draft)!;
  return {
    draft,
    field,
    message: buildCheckoutStartMessage(cartTotal),
  };
}

export function buildCartAddedPauseMessage(
  productName: string,
  quantity: number,
  cartTotal?: string
): string {
  const totalLine = cartTotal ? `\nCart total: ${cartTotal}` : "";
  const qty = quantity > 1 ? `${quantity}× ` : "";
  return `Done! ${qty}${productName} has been added to your cart.${totalLine}\n\nWould you like to checkout?`;
}

export function buildSessionAfterCartAdd(params: {
  sessionContext: {
    selectedProduct?: import("@/lib/shopify/types").ShopifyProduct;
    selectedVariantId?: string;
    selectedQuantity?: number;
    lastProducts?: import("@/lib/shopify/types").ShopifyProduct[];
    lastSearchQuery?: string;
  };
  cart: { cartId: string; totalPrice: string | null };
  variantId: string;
  quantity: number;
}) {
  const productName = params.sessionContext.selectedProduct?.title ?? "Your item";
  const introMessage = buildCartAddedPauseMessage(
    productName,
    params.quantity,
    params.cart.totalPrice ?? undefined
  );

  return {
    sessionContext: {
      ...params.sessionContext,
      stage: "cart_added_pause" as const,
      selectedVariantId: params.variantId,
      selectedQuantity: params.quantity,
    },
    cartAction: {
      cartId: params.cart.cartId,
      totalPrice: params.cart.totalPrice,
    },
    introMessage,
  };
}

export function normalizePhoneE164(phone: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (countryCode === "PK") {
    if (digits.startsWith("92")) return `+${digits}`;
    if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
    return `+92${digits}`;
  }
  return `+${digits}`;
}

export function toCartCheckoutDetails(draft: CheckoutDraft) {
  const { firstName, lastName } = splitFullName(draft.fullName ?? "Customer");
  const countryCode = draft.countryCode ?? DEFAULT_COUNTRY_CODE;
  const phone = normalizePhoneE164(draft.phone ?? "", countryCode);
  return {
    email: draft.email ?? "",
    phone,
    countryCode,
    firstName,
    lastName,
    address1: draft.address1 ?? "",
    address2: draft.address2 || undefined,
    city: draft.city ?? "",
    provinceCode: normalizeProvinceCode(draft.province ?? ""),
    zip: draft.zip ?? "",
  };
}

export function buildSelectableDeliveryAddress(details: ReturnType<typeof toCartCheckoutDetails>) {
  return {
    selected: true,
    oneTimeUse: true,
    address: {
      deliveryAddress: {
        firstName: details.firstName,
        lastName: details.lastName,
        address1: details.address1,
        address2: details.address2 || undefined,
        city: details.city,
        provinceCode: details.provinceCode,
        zip: details.zip,
        countryCode: details.countryCode,
        phone: details.phone,
      },
    },
  };
}
