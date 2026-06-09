import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import { getDecryptedStorefrontToken } from "@/lib/shopify/tokens";
import type { CartLineItem, CartSummaryWithLines, SearchSortKey, ShopifyProduct } from "@/lib/shopify/types";

/** Storefront API version (tokenless requires 2024-04+). */
const STOREFRONT_API_VERSION = "2025-01";

export type ParsedFilters = {
  query: string;
  color?: string;
  maxPrice?: number;
  minPrice?: number;
  category?: string;
  size?: string;
};

export type StorefrontStore = {
  id: string;
  shopDomain: string;
  storefrontToken: string | null;
};

export type ProductSearchPlan = {
  query: string;
  sortKey?: SearchSortKey;
  reverse?: boolean;
  first?: number;
};

type ShopifyProductSortKey = "RELEVANCE" | "CREATED_AT" | "PRICE" | "BEST_SELLING";

const SEARCH_KEYWORD_NOISE =
  /\b(show|me|some|please|can|you|i|want|find|search|for|the|a|an|products?)\b/gi;

export function buildSearchQuery(filters: ParsedFilters): string {
  const parts: string[] = [];
  const q = (filters.query ?? "").trim();
  if (q) parts.push(q);
  if (filters.color) parts.push(`tag:${filters.color}`);
  if (filters.maxPrice != null) parts.push(`variants.price:<${filters.maxPrice}`);
  if (filters.minPrice != null) parts.push(`variants.price:>${filters.minPrice}`);
  if (filters.category) parts.push(`product_type:${filters.category}`);
  if (filters.size) parts.push(`variants.option:${filters.size}`);
  return parts.join(" ").trim() || q;
}

const PRODUCT_SEARCH_QUERY = `
query SearchProducts(
  $query: String!
  $first: Int!
  $sortKey: ProductSortKeys
  $reverse: Boolean
) {
  products(query: $query, first: $first, sortKey: $sortKey, reverse: $reverse) {
    edges {
      node {
        id
        title
        description
        handle
        priceRange {
          minVariantPrice { amount currencyCode }
        }
        images(first: 1) { edges { node { url } } }
        variants(first: 10) {
          edges {
            node {
              id
              title
              availableForSale
              selectedOptions { name value }
            }
          }
        }
      }
    }
  }
}
`;

const CART_CREATE_MUTATION = `
mutation CreateCart($lines: [CartLineInput!]) {
  cartCreate(input: { lines: $lines }) {
    cart {
      id
      checkoutUrl
      cost { totalAmount { amount currencyCode } }
    }
    userErrors { field message }
  }
}
`;

const CART_LINES_ADD_MUTATION = `
mutation AddCartLines($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) {
    cart {
      id
      checkoutUrl
      cost { totalAmount { amount currencyCode } }
    }
    userErrors { field message }
  }
}
`;

const CART_BUYER_IDENTITY_UPDATE_MUTATION = `
mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
  cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
    cart {
      id
      checkoutUrl
    }
    userErrors { field message }
  }
}
`;

const CART_DELIVERY_ADDRESSES_REPLACE_MUTATION = `
mutation CartDeliveryAddressesReplace($cartId: ID!, $addresses: [CartSelectableAddressInput!]!) {
  cartDeliveryAddressesReplace(cartId: $cartId, addresses: $addresses) {
    cart {
      id
      checkoutUrl
    }
    userErrors { field message }
  }
}
`;

const CART_CHECKOUT_URL_QUERY = `
query CartCheckoutUrl($id: ID!) {
  cart(id: $id) {
    checkoutUrl
    cost {
      totalAmount { amount currencyCode }
    }
  }
}
`;

const CART_WITH_LINES_QUERY = `
query CartWithLines($id: ID!) {
  cart(id: $id) {
    checkoutUrl
    cost {
      totalAmount { amount currencyCode }
    }
    lines(first: 20) {
      edges {
        node {
          quantity
          merchandise {
            ... on ProductVariant {
              title
              price { amount currencyCode }
              product { title }
            }
          }
        }
      }
    }
  }
}
`;

async function markStoreReauthRequired(storeId: string): Promise<void> {
  await db
    .update(shopifyStores)
    .set({ authStatus: "REAUTH_REQUIRED", isActive: false })
    .where(eq(shopifyStores.id, storeId));
}

type StorefrontGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export class StorefrontRequestError extends Error {
  status: number;
  bodySnippet?: string;
  queryTried?: string;
  source: "tokenless" | "token";

  constructor(params: {
    message: string;
    status: number;
    source: "tokenless" | "token";
    bodySnippet?: string;
    queryTried?: string;
  }) {
    super(params.message);
    this.name = "StorefrontRequestError";
    this.status = params.status;
    this.source = params.source;
    this.bodySnippet = params.bodySnippet;
    this.queryTried = params.queryTried;
  }
}

function normalizeSearchKeywords(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(SEARCH_KEYWORD_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 120);
}

function mapSortKey(sortKey: SearchSortKey | undefined): ShopifyProductSortKey {
  if (sortKey === "CREATED_AT" || sortKey === "PRICE" || sortKey === "BEST_SELLING") return sortKey;
  return "RELEVANCE";
}

function buildSearchCandidates(plan: ProductSearchPlan): string[] {
  const requested = (plan.query || "").trim();
  const normalized = normalizeSearchKeywords(requested);
  const fallbackBySort = plan.sortKey === "CREATED_AT" ? "" : "*";
  const candidates = [requested, normalized, fallbackBySort, "*"];
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!unique.has(value)) unique.add(value);
  }
  return Array.from(unique);
}

async function executeStorefrontRequest<T>(
  shopDomain: string,
  gqlQuery: string,
  variables: Record<string, unknown>,
  accessToken: string | null,
  source: "tokenless" | "token"
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers["X-Shopify-Storefront-Access-Token"] = accessToken;
  }

  const res = await fetch(
    `https://${shopDomain}/api/${STOREFRONT_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query: gqlQuery, variables }),
    }
  );

  if (!res.ok) {
    const responseText = await res.text().catch(() => "");
    throw new StorefrontRequestError({
      message: `Shopify API error: ${res.status}`,
      status: res.status,
      source,
      bodySnippet: responseText.slice(0, 300),
      queryTried: JSON.stringify(variables).slice(0, 200),
    });
  }

  const json = (await res.json()) as StorefrontGraphqlResponse<T>;
  if (json.errors?.length) {
    throw new StorefrontRequestError({
      message: json.errors[0]?.message ?? "Storefront GraphQL error",
      status: 200,
      source,
      queryTried: JSON.stringify(variables).slice(0, 200),
    });
  }
  if (!json.data) {
    throw new StorefrontRequestError({
      message: "Missing Storefront response data",
      status: 200,
      source,
      queryTried: JSON.stringify(variables).slice(0, 200),
    });
  }
  return { ok: true, data: json.data };
}

/**
 * Calls Storefront GraphQL with tokenless access first, then falls back to a saved
 * storefront token when present. Token auth 401/403 marks the store for re-auth.
 */
async function storefrontFetch<T>(
  store: StorefrontStore,
  gqlQuery: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = getDecryptedStorefrontToken(store);

  try {
    const tokenless = await executeStorefrontRequest<T>(
      store.shopDomain,
      gqlQuery,
      variables,
      null,
      "tokenless"
    );
    if (tokenless.ok) return tokenless.data;
  } catch (error) {
    if (!token) throw error;
  }

  if (token) {
    try {
      const withToken = await executeStorefrontRequest<T>(
        store.shopDomain,
        gqlQuery,
        variables,
        token,
        "token"
      );
      if (withToken.ok) return withToken.data;
    } catch (error) {
      if (error instanceof StorefrontRequestError && (error.status === 401 || error.status === 403)) {
        await markStoreReauthRequired(store.id);
        throw new Error("SHOPIFY_AUTH_REVOKED");
      }
      throw error;
    }
  }

  throw new Error("Storefront request failed");
}

type ShopifySearchProductsResponse = {
  products: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        description: string;
        handle: string;
        priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
        images: { edges: Array<{ node: { url: string } }> };
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              availableForSale: boolean;
              selectedOptions: Array<{ name: string; value: string }>;
            };
          }>;
        };
      };
    }>;
  };
};

function mapProducts(shopDomain: string, data: ShopifySearchProductsResponse): ShopifyProduct[] {
  return data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currency: node.priceRange.minVariantPrice.currencyCode,
    image: node.images.edges[0]?.node.url ?? null,
    url: `https://${shopDomain}/products/${node.handle}`,
    variants: node.variants.edges.map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      available: v.availableForSale,
      options: v.selectedOptions.map((o) => ({ name: o.name, value: o.value })),
    })),
  }));
}

function isRecoverableSearchError(error: unknown): error is StorefrontRequestError {
  if (!(error instanceof StorefrontRequestError)) return false;
  if (error.status === 400) return true;
  return /parse|syntax|invalid|bad request|query/i.test(error.message);
}

function toProductSearchPlan(input: string | ProductSearchPlan): ProductSearchPlan {
  if (typeof input === "string") {
    return { query: input, sortKey: "RELEVANCE", reverse: false, first: 5 };
  }
  return {
    query: input.query,
    sortKey: input.sortKey ?? "RELEVANCE",
    reverse: input.reverse ?? false,
    first: input.first ?? 5,
  };
}

function formatTotal(
  cost: { totalAmount?: { amount?: string; currencyCode?: string } } | null | undefined
): string | null {
  if (!cost?.totalAmount?.amount) return null;
  const cur = cost.totalAmount.currencyCode ?? "";
  return `${cost.totalAmount.amount} ${cur}`.trim();
}

export async function searchProducts(
  store: StorefrontStore,
  input: string | ProductSearchPlan
): Promise<ShopifyProduct[]> {
  const plan = toProductSearchPlan(input);
  const sortKey = mapSortKey(plan.sortKey);
  const reverse = Boolean(plan.reverse);
  const first = plan.first ?? 5;
  const candidates = buildSearchCandidates(plan);

  let lastError: unknown;
  for (const queryCandidate of candidates) {
    try {
      const data = await storefrontFetch<ShopifySearchProductsResponse>(store, PRODUCT_SEARCH_QUERY, {
        query: queryCandidate,
        first,
        sortKey,
        reverse,
      });
      return mapProducts(store.shopDomain, data);
    } catch (error) {
      lastError = error;
      if (!isRecoverableSearchError(error)) throw error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

export async function addToCart(params: {
  store: StorefrontStore;
  variantId: string;
  quantity: number;
  cartId?: string | null;
}): Promise<{ cartId: string; checkoutUrl: string; totalPrice: string | null }> {
  const lines = [{ merchandiseId: params.variantId, quantity: params.quantity }];
  if (params.cartId) {
    const data = await storefrontFetch<{
      cartLinesAdd: {
        cart: {
          id: string;
          checkoutUrl: string;
          cost: { totalAmount: { amount: string; currencyCode: string } };
        } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(params.store, CART_LINES_ADD_MUTATION, {
      cartId: params.cartId,
      lines,
    });
    if (data.cartLinesAdd.userErrors.length) throw new Error(data.cartLinesAdd.userErrors[0].message);
    if (!data.cartLinesAdd.cart) throw new Error("Cart update failed");
    return {
      cartId: data.cartLinesAdd.cart.id,
      checkoutUrl: data.cartLinesAdd.cart.checkoutUrl,
      totalPrice: formatTotal(data.cartLinesAdd.cart.cost),
    };
  }

  const data = await storefrontFetch<{
    cartCreate: {
      cart: {
        id: string;
        checkoutUrl: string;
        cost: { totalAmount: { amount: string; currencyCode: string } };
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(params.store, CART_CREATE_MUTATION, { lines });
  if (data.cartCreate.userErrors.length) throw new Error(data.cartCreate.userErrors[0].message);
  if (!data.cartCreate.cart) throw new Error("Cart creation failed");
  return {
    cartId: data.cartCreate.cart.id,
    checkoutUrl: data.cartCreate.cart.checkoutUrl,
    totalPrice: formatTotal(data.cartCreate.cart.cost),
  };
}

export type CartCheckoutDetails = {
  email: string;
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode: string;
  zip: string;
};

export async function applyCheckoutDetailsToCart(params: {
  store: StorefrontStore;
  cartId: string;
  details: CartCheckoutDetails;
}): Promise<{ checkoutUrl: string }> {
  const deliveryAddressInput = {
    selected: true,
    oneTimeUse: true,
    address: {
      deliveryAddress: {
        firstName: params.details.firstName,
        lastName: params.details.lastName,
        address1: params.details.address1,
        address2: params.details.address2 || undefined,
        city: params.details.city,
        provinceCode: params.details.provinceCode,
        zip: params.details.zip,
        countryCode: params.details.countryCode,
        phone: params.details.phone,
      },
    },
  };

  const identityData = await storefrontFetch<{
    cartBuyerIdentityUpdate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(params.store, CART_BUYER_IDENTITY_UPDATE_MUTATION, {
    cartId: params.cartId,
    buyerIdentity: {
      email: params.details.email,
      phone: params.details.phone,
      countryCode: params.details.countryCode,
    },
  });

  const identityErrors = identityData.cartBuyerIdentityUpdate.userErrors;
  if (identityErrors.length) {
    throw new Error(
      `Buyer identity: ${identityErrors.map((e) => e.message).join("; ")}`
    );
  }

  const addressData = await storefrontFetch<{
    cartDeliveryAddressesReplace: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(params.store, CART_DELIVERY_ADDRESSES_REPLACE_MUTATION, {
    cartId: params.cartId,
    addresses: [deliveryAddressInput],
  });

  const addressErrors = addressData.cartDeliveryAddressesReplace.userErrors;
  if (addressErrors.length) {
    throw new Error(
      `Delivery address: ${addressErrors.map((e) => e.message).join("; ")}`
    );
  }

  const cart =
    addressData.cartDeliveryAddressesReplace.cart ??
    identityData.cartBuyerIdentityUpdate.cart;
  if (!cart?.checkoutUrl) throw new Error("Checkout URL unavailable");
  return { checkoutUrl: cart.checkoutUrl };
}

export async function getCartCheckoutUrl(params: {
  store: StorefrontStore;
  cartId: string;
}): Promise<string | null> {
  const summary = await getCartSummary(params);
  return summary?.checkoutUrl ?? null;
}

export async function getCartSummary(params: {
  store: StorefrontStore;
  cartId: string;
}): Promise<{ checkoutUrl: string; totalPrice: string | null } | null> {
  const data = await storefrontFetch<{
    cart: {
      checkoutUrl: string;
      cost: { totalAmount: { amount: string; currencyCode: string } };
    } | null;
  }>(params.store, CART_CHECKOUT_URL_QUERY, { id: params.cartId });
  if (!data.cart?.checkoutUrl) return null;
  return {
    checkoutUrl: data.cart.checkoutUrl,
    totalPrice: formatTotal(data.cart.cost),
  };
}

export async function getCartWithLines(params: {
  store: StorefrontStore;
  cartId: string;
}): Promise<CartSummaryWithLines | null> {
  const data = await storefrontFetch<{
    cart: {
      checkoutUrl: string;
      cost: { totalAmount: { amount: string; currencyCode: string } };
      lines: {
        edges: Array<{
          node: {
            quantity: number;
            merchandise: {
              title?: string;
              price?: { amount: string; currencyCode: string };
              product?: { title: string };
            };
          };
        }>;
      };
    } | null;
  }>(params.store, CART_WITH_LINES_QUERY, { id: params.cartId });

  if (!data.cart?.checkoutUrl) return null;

  const lines: CartLineItem[] = [];
  for (const { node } of data.cart.lines.edges) {
    const merchandise = node.merchandise;
    if (!merchandise?.title || !merchandise.price?.amount || !merchandise.product?.title) {
      continue;
    }
    lines.push({
      title: merchandise.product.title,
      variantTitle: merchandise.title,
      quantity: node.quantity,
      price: merchandise.price.amount,
      currency: merchandise.price.currencyCode,
    });
  }

  return {
    checkoutUrl: data.cart.checkoutUrl,
    totalPrice: formatTotal(data.cart.cost),
    lines,
  };
}
