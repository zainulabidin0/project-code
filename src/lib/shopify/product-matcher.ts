import type { ShopifyProduct } from "@/lib/shopify/types";

export type ScoredProduct = {
  product: ShopifyProduct;
  score: number;
};

type ProductVariant = ShopifyProduct["variants"][number];

/**
 * Score products against the search query to find the best match.
 * Higher score = better match. Used when buy-intent needs auto-selection.
 */
export function rankProducts(products: ShopifyProduct[], query: string): ScoredProduct[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const scored = products.map((product) => {
    const title = product.title.toLowerCase();
    let score = 0;

    if (title === query.toLowerCase()) score += 100;

    const matchedWords = queryWords.filter((w) => title.includes(w));
    if (queryWords.length > 0) {
      score += (matchedWords.length / queryWords.length) * 50;
    }

    if (title.startsWith(query.toLowerCase())) score += 20;

    const hasAvailableVariant = product.variants?.some((v) => v.available);
    if (hasAvailableVariant) score += 10;

    return { product, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Decide if we're confident enough to auto-select without asking the user.
 */
export function isConfidentMatch(ranked: ScoredProduct[]): boolean {
  if (ranked.length === 0) return false;
  if (ranked.length === 1) return true;

  const [top, second] = ranked;
  return top.score >= 50 && top.score - second.score >= 20;
}

function getDistinguishingOptionNames(product: ShopifyProduct): string[] {
  const names = new Set<string>();
  for (const variant of product.variants ?? []) {
    for (const option of variant.options ?? []) {
      const name = option.name.toLowerCase();
      if (!["title", "default title", "default"].includes(name)) {
        names.add(option.name);
      }
    }
  }
  return Array.from(names);
}

function variantPrice(variant: ProductVariant, product: ShopifyProduct): string {
  return product.price;
}

/**
 * Pick the best variant of a product automatically when possible.
 */
export function pickVariant(product: ShopifyProduct): {
  variant: ProductVariant;
  price: string;
  needsClarification: boolean;
} {
  const variants = product.variants ?? [];

  if (variants.length === 0) {
    throw new Error(`Product ${product.id} has no variants`);
  }

  if (variants.length === 1) {
    return { variant: variants[0], price: variantPrice(variants[0], product), needsClarification: false };
  }

  const distinguishingOptions = getDistinguishingOptionNames(product);

  if (distinguishingOptions.length === 0) {
    const firstAvailable = variants.find((v) => v.available) ?? variants[0];
    return {
      variant: firstAvailable,
      price: variantPrice(firstAvailable, product),
      needsClarification: false,
    };
  }

  return {
    variant: variants[0],
    price: variantPrice(variants[0], product),
    needsClarification: true,
  };
}
