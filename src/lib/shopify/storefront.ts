import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import { getDecryptedStorefrontToken } from "@/lib/shopify/tokens";
import type { ShopifyProduct } from "@/lib/shopify/types";

/** Storefront API version (tokenless requires 2024-04+). */
const STOREFRONT_API_VERSION = "2024-10";

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
query SearchProducts($query: String!, $first: Int!) {
  products(query: $query, first: $first) {
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

async function executeStorefrontRequest<T>(
  shopDomain: string,
  query: string,
  variables: Record<string, unknown>,
  accessToken: string | null
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
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    return { ok: false, status: res.status, message: `Shopify API error: ${res.status}` };
  }

  const json = (await res.json()) as StorefrontGraphqlResponse<T>;
  if (json.errors?.length) {
    return {
      ok: false,
      status: 200,
      message: json.errors[0]?.message ?? "Storefront GraphQL error",
    };
  }
  if (!json.data) {
    return { ok: false, status: 200, message: "Missing Storefront response data" };
  }
  return { ok: true, data: json.data };
}

/**
 * Calls Storefront GraphQL with tokenless access first, then falls back to a saved
 * storefront token when present. Token auth 401/403 marks the store for re-auth.
 */
async function storefrontFetch<T>(
  store: StorefrontStore,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = getDecryptedStorefrontToken(store);

  const tokenless = await executeStorefrontRequest<T>(
    store.shopDomain,
    query,
    variables,
    null
  );
  if (tokenless.ok) return tokenless.data;

  if (token) {
    const withToken = await executeStorefrontRequest<T>(
      store.shopDomain,
      query,
      variables,
      token
    );
    if (withToken.ok) return withToken.data;

    if (withToken.status === 401 || withToken.status === 403) {
      await markStoreReauthRequired(store.id);
      throw new Error("SHOPIFY_AUTH_REVOKED");
    }
  }

  throw new Error(tokenless.message || "Storefront request failed");
}

function formatTotal(
  cost: { totalAmount?: { amount?: string; currencyCode?: string } } | null | undefined
): string | null {
  if (!cost?.totalAmount?.amount) return null;
  const cur = cost.totalAmount.currencyCode ?? "";
  return `${cost.totalAmount.amount} ${cur}`.trim();
}

export async function searchProducts(store: StorefrontStore, query: string): Promise<ShopifyProduct[]> {
  const data = await storefrontFetch<{
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
  }>(store, PRODUCT_SEARCH_QUERY, { query, first: 5 });

  return data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currency: node.priceRange.minVariantPrice.currencyCode,
    image: node.images.edges[0]?.node.url ?? null,
    url: `https://${store.shopDomain}/products/${node.handle}`,
    variants: node.variants.edges.map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      available: v.availableForSale,
      options: v.selectedOptions.map((o) => ({ name: o.name, value: o.value })),
    })),
  }));
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
