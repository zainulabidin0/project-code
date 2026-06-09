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

export function isShowSavedDetailsRequest(message: string): boolean {
  const text = message.trim().toLowerCase();
  return (
    /\b(show|what|tell|give|list|display)\b.*\b(my|the|saved)\b.*\b(name|email|phone|contact|number|address|delivery|details?)\b/.test(
      text
    ) ||
    /\b(my\s+(name|email|phone|contact|number|address|details?))\b/.test(text) ||
    /\bcontact\s*(no\.?|number)\b/.test(text)
  );
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
  islamabad: "IS",
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

/** Major PK cities → Shopify provinceCode (shoppers often say city instead of province). */
const PK_CITY_TO_PROVINCE: Record<string, string> = {
  lahore: "PB",
  faisalabad: "PB",
  rawalpindi: "PB",
  multan: "PB",
  gujranwala: "PB",
  sialkot: "PB",
  sargodha: "PB",
  bahawalpur: "PB",
  gujrat: "PB",
  sheikhupura: "PB",
  karachi: "SD",
  hyderabad: "SD",
  sukkur: "SD",
  larkana: "SD",
  peshawar: "KP",
  mardan: "KP",
  abbottabad: "KP",
  mingora: "KP",
  quetta: "BA",
  turbat: "BA",
  islamabad: "IS",
  gilgit: "GB",
  skardu: "GB",
  muzaffarabad: "JK",
  mirpur: "JK",
};

const PK_DEFAULT_ZIP_BY_PROVINCE: Record<string, string> = {
  PB: "54000",
  SD: "75000",
  KP: "25000",
  BA: "87300",
  IS: "44000",
  GB: "15700",
  JK: "12350",
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

export function buildCheckoutReadyMessage(draft?: CheckoutDraft): string {
  if (draft && !isCheckoutDraftComplete(draft)) {
    return "I still need a few delivery details before checkout can be prefilled. I'll ask the remaining questions now.";
  }
  return "All set! Your delivery details are saved.\n\nTap the Complete order button below to open checkout — your name and address will already be filled in.";
}

export function buildCheckoutApplyFailedMessage(): string {
  return "I saved your details here, but couldn't push them to Shopify checkout just now. Please say \"checkout\" to try again.";
}

export function buildCheckoutResumeMessage(field: CheckoutField): string {
  return `Let's continue checkout.\n\n${getCheckoutQuestion(field)}`;
}

export function buildEmptyCartCheckoutMessage(): string {
  return "Your cart is empty right now. Tell me what you'd like to buy and I'll add it for you first.";
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Customer", lastName: "Customer" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normalizeProvinceCode(province: string, city?: string): string {
  const provinceKey = province.trim().toLowerCase();
  if (provinceKey && PK_PROVINCE_CODES[provinceKey]) {
    return PK_PROVINCE_CODES[provinceKey];
  }
  if (provinceKey && PK_CITY_TO_PROVINCE[provinceKey]) {
    return PK_CITY_TO_PROVINCE[provinceKey];
  }

  const cityKey = (city ?? "").trim().toLowerCase();
  if (cityKey && PK_CITY_TO_PROVINCE[cityKey]) {
    return PK_CITY_TO_PROVINCE[cityKey];
  }

  if (/punjab/i.test(province)) return "PB";
  if (/sindh/i.test(province)) return "SD";
  if (/khyber|kpk/i.test(province)) return "KP";
  if (/baloch/i.test(province)) return "BA";
  if (/islamabad|ict/i.test(province)) return "IS";
  if (/gilgit/i.test(province)) return "GB";
  if (/kashmir|ajk/i.test(province)) return "JK";

  if (cityKey && PK_CITY_TO_PROVINCE[cityKey]) {
    return PK_CITY_TO_PROVINCE[cityKey];
  }

  return "PB";
}

export function normalizeZipForPakistan(zip: string, provinceCode: string): string {
  const digits = zip.replace(/\D/g, "");
  if (digits.length === 5) return digits;
  return PK_DEFAULT_ZIP_BY_PROVINCE[provinceCode] ?? "54000";
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

export type CheckoutUrlPrefillDetails = {
  email?: string;
  phone?: string;
  countryCode?: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  provinceCode?: string;
  zip?: string;
};

/**
 * Appends Shopify checkout[...] query params to a cart checkoutUrl.
 * Works with /checkouts/cn/... URLs from cart.checkoutUrl.
 * Shopify may ignore some fields on stores without Checkout Extensibility — best-effort prefill.
 */
export function buildPrefilledCheckoutUrl(
  baseCheckoutUrl: string,
  details: CheckoutUrlPrefillDetails
): string {
  if (!baseCheckoutUrl?.trim()) return baseCheckoutUrl;

  try {
    const url = new URL(baseCheckoutUrl);
    const set = (key: string, value?: string) => {
      const trimmed = value?.trim();
      if (trimmed) url.searchParams.set(key, trimmed);
    };

    set("checkout[email]", details.email);
    set("checkout[shipping_address][first_name]", details.firstName);
    set("checkout[shipping_address][last_name]", details.lastName);
    set("checkout[shipping_address][address1]", details.address1);
    set("checkout[shipping_address][address2]", details.address2);
    set("checkout[shipping_address][city]", details.city);
    set("checkout[shipping_address][province]", details.provinceCode);
    set("checkout[shipping_address][country]", details.countryCode);
    set("checkout[shipping_address][zip]", details.zip);
    set("checkout[shipping_address][phone]", details.phone);

    return url.toString();
  } catch {
    return baseCheckoutUrl;
  }
}

export function enrichCheckoutUrlWithDraft(
  baseCheckoutUrl: string,
  draft?: CheckoutDraft
): string {
  if (!draft) return baseCheckoutUrl;
  return buildPrefilledCheckoutUrl(baseCheckoutUrl, toCartCheckoutDetails(draft));
}

export function toCartCheckoutDetails(draft: CheckoutDraft) {
  const { firstName, lastName } = splitFullName(draft.fullName ?? "Customer");
  const countryCode = draft.countryCode ?? DEFAULT_COUNTRY_CODE;
  const phone = normalizePhoneE164(draft.phone ?? "", countryCode);
  const city = (draft.city ?? "").trim();
  const provinceCode = normalizeProvinceCode(draft.province ?? "", city);
  const zip =
    countryCode === "PK"
      ? normalizeZipForPakistan(draft.zip ?? "", provinceCode)
      : (draft.zip ?? "").trim();

  return {
    email: draft.email ?? "",
    phone,
    countryCode,
    firstName,
    lastName: lastName || firstName || "Customer",
    address1: (draft.address1 ?? "").trim(),
    address2: draft.address2?.trim() || undefined,
    city,
    provinceCode,
    zip,
  };
}

export type DeliveryAddressPayload = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
  phone: string;
};

export function buildSelectableDeliveryAddress(details: DeliveryAddressPayload) {
  return {
    selected: true,
    oneTimeUse: true,
    validationStrategy: "COUNTRY_CODE_ONLY" as const,
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

export function buildSavedAddressSummary(draft: CheckoutDraft): string {
  const lines: string[] = [];
  if (draft.fullName) lines.push(`Name: ${draft.fullName}`);
  if (draft.email) lines.push(`Email: ${draft.email}`);
  if (draft.phone) lines.push(`Phone: ${draft.phone}`);
  if (draft.address1) lines.push(`Address: ${draft.address1}${draft.address2 ? `, ${draft.address2}` : ""}`);
  if (draft.city) lines.push(`City: ${draft.city}`);
  if (draft.province) lines.push(`Province: ${draft.province}`);
  if (draft.zip) lines.push(`Postal code: ${draft.zip}`);
  return lines.join("\n");
}

export function buildUseSavedAddressPrompt(draft: CheckoutDraft, cartTotal?: string): string {
  const summary = buildSavedAddressSummary(draft);
  const totalLine = cartTotal ? `\nCart total: ${cartTotal}` : "";
  return `I have your delivery details saved from before:${totalLine}\n\n${summary}\n\nShall I use this address? Reply yes to confirm or no to enter a new one.`;
}

export function beginCheckoutWithSavedDraft(
  savedDraft: CheckoutDraft,
  cartTotal?: string
): {
  draft: CheckoutDraft;
  field: CheckoutField | null;
  message: string;
  usingSavedDraft: true;
} {
  return {
    draft: savedDraft,
    field: null,
    message: buildUseSavedAddressPrompt(savedDraft, cartTotal),
    usingSavedDraft: true,
  };
}

export function beginCheckoutFresh(cartTotal?: string): {
  draft: CheckoutDraft;
  field: CheckoutField;
  message: string;
  usingSavedDraft: false;
} {
  const draft = createInitialCheckoutDraft();
  const field = getNextCheckoutField(draft)!;
  return {
    draft,
    field,
    message: buildCheckoutStartMessage(cartTotal),
    usingSavedDraft: false,
  };
}
