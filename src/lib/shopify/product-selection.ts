import type { ShopifyProduct } from "@/lib/shopify/types";

export type ProductSelectionResult = {
  product: ShopifyProduct;
  variantId?: string;
  needsVariantChoice: boolean;
  productIndex: number;
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  sixth: 5,
  seventh: 6,
  eighth: 7,
  ninth: 8,
  tenth: 9,
  "1st": 0,
  "2nd": 1,
  "3rd": 2,
  "4th": 3,
  "5th": 4,
};

export function buildProductSuggestionLabel(product: ShopifyProduct): string {
  const price = product.price ? `${product.currency ? product.currency + " " : ""}${product.price}`.trim() : "";
  return price ? `${product.title} — ${price}` : product.title;
}

export function buildProductSuggestions(products: ShopifyProduct[]): string[] {
  return products.map(buildProductSuggestionLabel);
}

export function pickDefaultVariant(product: ShopifyProduct): string | undefined {
  const available = product.variants.filter((v) => v.available);
  return available.length === 1 ? available[0].id : undefined;
}

function parseOrdinalIndex(message: string, max: number): number | null {
  const text = message.toLowerCase().trim();

  const hashMatch = text.match(/#(\d+)/);
  if (hashMatch) {
    const idx = parseInt(hashMatch[1], 10) - 1;
    if (idx >= 0 && idx < max) return idx;
  }

  const numMatch = text.match(/\b(\d+)\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < max) return idx;
  }

  for (const [word, idx] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text) && idx < max) {
      return idx;
    }
  }

  return null;
}

function matchByChipLabel(message: string, products: ShopifyProduct[]): number | null {
  const trimmed = message.trim().toLowerCase();
  for (let i = 0; i < products.length; i++) {
    const label = buildProductSuggestionLabel(products[i]).toLowerCase();
    if (trimmed === label || trimmed === products[i].title.toLowerCase()) {
      return i;
    }
  }
  return null;
}

function matchByTitleKeywords(message: string, products: ShopifyProduct[]): number | null {
  const text = message
    .toLowerCase()
    .replace(/\b(the|one|that|this|please|want|i|d|like|get|take|choose|pick|select)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length < 2) return null;

  let bestIndex: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < products.length; i++) {
    const title = products[i].title.toLowerCase();
    const titleWords = title.split(/\s+/).filter((w) => w.length > 2);
    const queryWords = text.split(/\s+/).filter((w) => w.length > 1);

    let score = 0;
    for (const qw of queryWords) {
      if (title.includes(qw)) score += qw.length;
    }
    for (const tw of titleWords) {
      if (text.includes(tw)) score += tw.length;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 3 ? bestIndex : null;
}

function resolveVariant(product: ShopifyProduct, variantHint?: string): {
  variantId?: string;
  needsVariantChoice: boolean;
} {
  const available = product.variants.filter((v) => v.available);
  if (available.length === 0) {
    return { needsVariantChoice: true };
  }
  if (available.length === 1) {
    return { variantId: available[0].id, needsVariantChoice: false };
  }

  if (variantHint) {
    const hint = variantHint.toLowerCase();
    const matched = available.find(
      (v) =>
        v.title.toLowerCase().includes(hint) ||
        v.options.some((o) => o.value.toLowerCase().includes(hint))
    );
    if (matched) {
      return { variantId: matched.id, needsVariantChoice: false };
    }
  }

  return { needsVariantChoice: true };
}

export function resolveProductSelection(
  message: string,
  products: ShopifyProduct[],
  opts?: { productIndex?: number; productTitle?: string; variantHint?: string }
): ProductSelectionResult | null {
  if (!products.length) return null;

  let index: number | null = null;

  if (typeof opts?.productIndex === "number" && opts.productIndex >= 0 && opts.productIndex < products.length) {
    index = opts.productIndex;
  }

  if (index === null) {
    index = matchByChipLabel(message, products);
  }
  if (index === null) {
    index = parseOrdinalIndex(message, products.length);
  }
  if (index === null && opts?.productTitle) {
    const titleLower = opts.productTitle.toLowerCase();
    index = products.findIndex((p) => p.title.toLowerCase().includes(titleLower));
    if (index < 0) index = null;
  }
  if (index === null) {
    index = matchByTitleKeywords(message, products);
  }

  if (index === null || index < 0 || index >= products.length) return null;

  const product = products[index];
  const { variantId, needsVariantChoice } = resolveVariant(product, opts?.variantHint ?? message);

  return {
    product,
    variantId,
    needsVariantChoice,
    productIndex: index,
  };
}

export function resolveVariantFromMessage(
  message: string,
  product: ShopifyProduct
): string | undefined {
  const available = product.variants.filter((v) => v.available);
  const text = message.trim().toLowerCase();
  if (!text) return undefined;

  const exact = available.find((v) => v.title.toLowerCase() === text);
  if (exact) return exact.id;

  const partial = available.find(
    (v) =>
      v.title.toLowerCase().includes(text) ||
      text.includes(v.title.toLowerCase()) ||
      v.options.some((o) => o.value.toLowerCase() === text || text.includes(o.value.toLowerCase()))
  );
  return partial?.id;
}

export function parseRequestedQuantity(message: string): number | undefined {
  const text = message.toLowerCase();
  const patterns = [
    /\b(\d+)\s*(?:piece|pieces|pcs|pc|qty|quantity|items?|units?)\b/i,
    /\b(?:piece|pieces|pcs|pc|qty)\s*(\d+)\b/i,
    /\bx\s*(\d+)\b/i,
    /\b(\d+)\s*x\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const qty = parseInt(match[1], 10);
      if (qty >= 1 && qty <= 10) return qty;
    }
  }
  return undefined;
}

export function isPurchaseIntent(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\b(buy|purchase|order|add|cart|krne|krna|kharid|lena|chahiye|chahye|dedo|add to cart|checkout)\b/i.test(
    text
  );
}

export function productsForDisplay(
  sessionContext: {
    stage: string;
    selectedProduct?: ShopifyProduct;
    lastProducts?: ShopifyProduct[];
  },
  products: ShopifyProduct[]
): ShopifyProduct[] {
  if (
    sessionContext.selectedProduct &&
    (sessionContext.stage === "awaiting_confirm" ||
      sessionContext.stage === "collecting_checkout" ||
      sessionContext.stage === "checkout_ready" ||
      sessionContext.stage === "completed")
  ) {
    return [sessionContext.selectedProduct];
  }
  if (sessionContext.stage === "presenting_options" && sessionContext.lastProducts?.length) {
    return sessionContext.lastProducts;
  }
  return products;
}

export function isDirectCartAddRequest(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (isConfirmYes(text)) return true;
  if (/^add\b/.test(text)) return true;
  if (/\badd to cart\b/.test(text)) return true;
  if (/\badd (?:it|them|this|those)\b/.test(text)) return true;
  if (/\bplease add\b/.test(text)) return true;
  if (/\b(?:buy|purchase|order|krne|krna|kharid|lena)\b/.test(text) && parseRequestedQuantity(text)) {
    return true;
  }
  return false;
}

export function isConfirmYes(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /^(yes|yeah|yep|yup|ok|okay|add it|add to cart|please do|go ahead|do it|confirm|absolutely|definitely)\b/.test(
    text
  );
}

export function isShowCartIntent(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\b(show(?:\s+me)?(?:\s+my)?\s+cart|view(?:\s+my)?\s+cart|my\s+cart|cart\s+(?:details?|items?|products?)|what(?:'s|\s+is)\s+in\s+(?:my\s+)?cart|cart\s+dekhao|mera\s+cart)\b/.test(
    text
  );
}

export function isCartAddedPauseConfirm(message: string): boolean {
  return isConfirmYes(message);
}

export function isQuantityOnlyMessage(message: string): number | null {
  const text = message.trim();
  const numMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const wordMatch = numMap[text.toLowerCase()];
  if (wordMatch !== undefined) return wordMatch;
  const numMatch = text.match(/^(\d+)$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 10) return n;
  }
  return null;
}

/** Shopper wants to see real catalog items after a failed search. */
export function isBrowseAlternativesRequest(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /\b(show me|what else|something else|something similar|other products|alternatives|what do you have|what you have|else you have|more options|popular products|best selling|latest products|browse|look around|see what you have)\b/.test(
    text
  );
}

export function isVagueGreeting(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings|salam|assalam)[!.?\s]*$/.test(
    text
  );
}
