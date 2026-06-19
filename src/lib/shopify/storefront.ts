import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import {
  buildPrefilledCheckoutUrl,
  buildSelectableDeliveryAddress,
} from "@/lib/shopify/checkout-collector";
import { getDecryptedStorefrontToken } from "@/lib/shopify/tokens";
import type {
  CartLineItem,
  CartSummary,
  CartSummaryWithLines,
  SearchSortKey,
  ShopifyProduct,
} from "@/lib/shopify/types";

/** Storefront API version (tokenless requires 2024-04+). */
const STOREFRONT_API_VERSION = "2025-10";

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
  /\b(show|me|some|please|can|you|i|want|find|search|for|the|a|an|products?|buy|get|order|need|like|looking)\b/gi;

const LOG_PREFIX_SEARCH = "[storefront/search]";

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

const CART_DELIVERY_ADDRESS_FIELDS = `
      delivery {
        addresses {
          id
          selected
          oneTimeUse
          address {
            ... on CartDeliveryAddress {
              firstName
              lastName
              address1
              address2
              city
              provinceCode
              zip
              countryCode
              phone
            }
          }
        }
      }
`;

const CART_BUYER_IDENTITY_UPDATE_MUTATION = `
mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
  cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
    cart {
      id
      checkoutUrl
      buyerIdentity {
        email
        phone
        countryCode
      }
      ${CART_DELIVERY_ADDRESS_FIELDS}
    }
    userErrors { field message }
    warnings { message code target }
  }
}
`;

const CART_DELIVERY_ADDRESSES_ADD_MUTATION = `
mutation CartDeliveryAddressesAdd($cartId: ID!, $addresses: [CartSelectableAddressInput!]!) {
  cartDeliveryAddressesAdd(cartId: $cartId, addresses: $addresses) {
    cart {
      id
      checkoutUrl
      buyerIdentity {
        email
        phone
        countryCode
      }
      ${CART_DELIVERY_ADDRESS_FIELDS}
    }
    userErrors { field message }
    warnings { message code target }
  }
}
`;

const CART_DELIVERY_ADDRESSES_REPLACE_MUTATION = `
mutation CartDeliveryAddressesReplace($cartId: ID!, $addresses: [CartSelectableAddressInput!]!) {
  cartDeliveryAddressesReplace(cartId: $cartId, addresses: $addresses) {
    cart {
      id
      checkoutUrl
      buyerIdentity {
        email
        phone
        countryCode
      }
      ${CART_DELIVERY_ADDRESS_FIELDS}
    }
    userErrors { field message }
    warnings { message code target }
  }
}
`;

const CART_CHECKOUT_PREFILL_QUERY = `
query CartCheckoutPrefill($id: ID!) {
  cart(id: $id) {
    id
    checkoutUrl
    buyerIdentity {
      email
      phone
      countryCode
    }
    ${CART_DELIVERY_ADDRESS_FIELDS}
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

const CART_LINES_REMOVE_MUTATION = `
mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
  cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
    cart {
      id
      checkoutUrl
      cost { totalAmount { amount currencyCode } }
    }
    userErrors { field message }
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
          id
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
    .replace(/^\d+\s*x?\s*/i, "")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(SEARCH_KEYWORD_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 120);
}

/** Try singular form of the last word (e.g. "wireless chargers" → "wireless charger"). */
function singularizeSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1];
  if (last.length > 3 && last.endsWith("s") && !last.endsWith("ss")) {
    words[words.length - 1] = last.slice(0, -1);
    return words.join(" ");
  }
  return trimmed;
}

function mapSortKey(sortKey: SearchSortKey | undefined): ShopifyProductSortKey {
  if (sortKey === "CREATED_AT" || sortKey === "PRICE" || sortKey === "BEST_SELLING") return sortKey;
  return "RELEVANCE";
}

function buildSearchCandidates(plan: ProductSearchPlan): string[] {
  const requested = (plan.query || "").trim();
  const normalized = normalizeSearchKeywords(requested);
  const singular = singularizeSearchQuery(normalized || requested);
  const fallbackBySort = plan.sortKey === "CREATED_AT" ? "" : "*";
  const candidates = [requested, normalized, singular, fallbackBySort, "*"];
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (value && !unique.has(value)) unique.add(value);
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
  const edges = data?.products?.edges ?? [];
  return edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange?.minVariantPrice?.amount ?? "0",
    currency: node.priceRange?.minVariantPrice?.currencyCode ?? "",
    image: node.images?.edges?.[0]?.node?.url ?? null,
    url: `https://${shopDomain}/products/${node.handle}`,
    variants: (node.variants?.edges ?? []).map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      available: v.availableForSale,
      options: (v.selectedOptions ?? []).map((o) => ({ name: o.name, value: o.value })),
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

  console.log(LOG_PREFIX_SEARCH, "search start", {
    storeId: store.id,
    originalQuery: plan.query,
    candidates,
    sortKey,
    reverse,
    first,
  });

  let lastError: unknown;
  let lastEmptyCandidate: string | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const queryCandidate = candidates[i];
    try {
      const data = await storefrontFetch<ShopifySearchProductsResponse>(store, PRODUCT_SEARCH_QUERY, {
        query: queryCandidate,
        first,
        sortKey,
        reverse,
      });
      const edgeCount = data?.products?.edges?.length ?? 0;
      const products = mapProducts(store.shopDomain, data);

      console.log(LOG_PREFIX_SEARCH, "candidate result", {
        query: queryCandidate,
        edgeCount,
        mappedCount: products.length,
        titles: products.slice(0, 3).map((p) => p.title),
      });

      if (products.length > 0) {
        if (queryCandidate !== plan.query) {
          console.log(LOG_PREFIX_SEARCH, "resolved via fallback candidate", {
            originalQuery: plan.query,
            winningQuery: queryCandidate,
          });
        }
        return products;
      }

      lastEmptyCandidate = queryCandidate;
      const isLast = i === candidates.length - 1;
      if (isLast) {
        console.warn(LOG_PREFIX_SEARCH, "all candidates returned zero products", {
          originalQuery: plan.query,
          candidatesTried: candidates,
          lastEmptyCandidate,
        });
        return products;
      }
    } catch (error) {
      lastError = error;
      console.warn(LOG_PREFIX_SEARCH, "candidate failed", {
        query: queryCandidate,
        error: error instanceof Error ? error.message : String(error),
      });
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
      } | null;
    }>(params.store, CART_LINES_ADD_MUTATION, {
      cartId: params.cartId,
      lines,
    });
    const cartLinesAdd = data?.cartLinesAdd;
    if (!cartLinesAdd) throw new Error("cartLinesAdd returned no payload");
    const userErrors = cartLinesAdd.userErrors ?? [];
    if (userErrors.length) throw new Error(userErrors[0]?.message ?? "Cart update failed");
    if (!cartLinesAdd.cart) throw new Error("Cart update failed");
    return {
      cartId: cartLinesAdd.cart.id,
      checkoutUrl: cartLinesAdd.cart.checkoutUrl,
      totalPrice: formatTotal(cartLinesAdd.cart.cost),
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
    } | null;
  }>(params.store, CART_CREATE_MUTATION, { lines });
  const cartCreate = data?.cartCreate;
  if (!cartCreate) throw new Error("cartCreate returned no payload");
  const createErrors = cartCreate.userErrors ?? [];
  if (createErrors.length) throw new Error(createErrors[0]?.message ?? "Cart creation failed");
  if (!cartCreate.cart) throw new Error("Cart creation failed");
  return {
    cartId: cartCreate.cart.id,
    checkoutUrl: cartCreate.cart.checkoutUrl,
    totalPrice: formatTotal(cartCreate.cart.cost),
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

const LOG_PREFIX = "[storefront/checkout]";

type CartDeliveryAddressNode = {
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  countryCode?: string | null;
  phone?: string | null;
};

type CartPrefillSnapshot = {
  buyerIdentity: {
    email?: string | null;
    phone?: string | null;
    countryCode?: string | null;
  } | null;
  deliveryAddresses: Array<{
    id?: string;
    selected?: boolean;
    oneTimeUse?: boolean;
    address: CartDeliveryAddressNode | null;
  }>;
};

type CartSelectableAddressNode = {
  id?: string;
  selected?: boolean;
  oneTimeUse?: boolean;
  address: CartDeliveryAddressNode | null;
};

type CartPrefillCart = {
  id: string;
  checkoutUrl: string;
  buyerIdentity?: CartPrefillSnapshot["buyerIdentity"];
  delivery?: {
    addresses: CartSelectableAddressNode[];
  } | null;
};

type DeliveryAddressMutationResult = {
  mutation: "cartDeliveryAddressesReplace" | "cartDeliveryAddressesAdd";
  cart: CartPrefillCart | null;
  userErrors: Array<{ field?: string[]; message: string }>;
  warnings: Array<{ message: string; code?: string; target?: string }>;
};

function isReplaceMutationUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("cartDeliveryAddressesReplace");
}

function snapshotDeliveryAddresses(cart: CartPrefillCart | null | undefined): CartPrefillSnapshot {
  const addresses = cart?.delivery?.addresses ?? [];
  return {
    buyerIdentity: cart?.buyerIdentity ?? null,
    deliveryAddresses: addresses.map((entry) => ({
      id: entry.id,
      selected: entry.selected,
      oneTimeUse: entry.oneTimeUse,
      address: entry.address ?? null,
    })),
  };
}

function summarizePrefillSnapshot(label: string, snapshot: CartPrefillSnapshot) {
  const selected =
    snapshot.deliveryAddresses.find((entry) => entry.selected) ??
    snapshot.deliveryAddresses[0];
  const address = selected?.address;
  return {
    label,
    buyerEmail: snapshot.buyerIdentity?.email ?? null,
    buyerPhone: snapshot.buyerIdentity?.phone ?? null,
    buyerCountryCode: snapshot.buyerIdentity?.countryCode ?? null,
    deliveryAddressCount: snapshot.deliveryAddresses.length,
    selectedDeliveryAddress: address
      ? {
          firstName: address.firstName ?? null,
          lastName: address.lastName ?? null,
          address1: address.address1 ?? null,
          city: address.city ?? null,
          provinceCode: address.provinceCode ?? null,
          zip: address.zip ?? null,
          countryCode: address.countryCode ?? null,
          phone: address.phone ?? null,
        }
      : null,
  };
}

function hasDeliveryAddressOnCart(snapshot: CartPrefillSnapshot): boolean {
  return snapshot.deliveryAddresses.some((entry) => {
    const address = entry.address;
    return Boolean(address?.address1?.trim() || address?.city?.trim());
  });
}

async function readCartCheckoutPrefill(
  store: StorefrontStore,
  cartId: string
): Promise<CartPrefillSnapshot | null> {
  const data = await storefrontFetch<{
    cart: CartPrefillCart | null;
  }>(store, CART_CHECKOUT_PREFILL_QUERY, { id: cartId }).catch((error) => {
    console.warn(LOG_PREFIX, "prefill verification query failed", {
      cartId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!data?.cart) return null;
  return snapshotDeliveryAddresses(data.cart);
}

async function applyDeliveryAddressToCart(params: {
  store: StorefrontStore;
  cartId: string;
  addresses: ReturnType<typeof buildSelectableDeliveryAddress>[];
}): Promise<DeliveryAddressMutationResult> {
  try {
    const replaceData = await storefrontFetch<{
      cartDeliveryAddressesReplace: Omit<DeliveryAddressMutationResult, "mutation"> | null;
    }>(params.store, CART_DELIVERY_ADDRESSES_REPLACE_MUTATION, {
      cartId: params.cartId,
      addresses: params.addresses,
    });
    const replacePayload = replaceData?.cartDeliveryAddressesReplace;
    if (!replacePayload) {
      throw new Error("cartDeliveryAddressesReplace returned no payload");
    }
    const replaceErrors = replacePayload.userErrors ?? [];
    if (replaceErrors.length) {
      throw new Error(replaceErrors[0]?.message ?? "Delivery address replace failed");
    }
    return {
      mutation: "cartDeliveryAddressesReplace",
      cart: replacePayload.cart ?? null,
      userErrors: replaceErrors,
      warnings: replacePayload.warnings ?? [],
    };
  } catch (error) {
    if (!isReplaceMutationUnavailable(error)) throw error;
    console.warn(LOG_PREFIX, "cartDeliveryAddressesReplace unavailable, falling back to cartDeliveryAddressesAdd");
  }

  const addData = await storefrontFetch<{
    cartDeliveryAddressesAdd: Omit<DeliveryAddressMutationResult, "mutation"> | null;
  }>(params.store, CART_DELIVERY_ADDRESSES_ADD_MUTATION, {
    cartId: params.cartId,
    addresses: params.addresses,
  });
  const addPayload = addData?.cartDeliveryAddressesAdd;
  if (!addPayload) {
    throw new Error("cartDeliveryAddressesAdd returned no payload");
  }
  const addErrors = addPayload.userErrors ?? [];
  if (addErrors.length) {
    throw new Error(addErrors[0]?.message ?? "Delivery address add failed");
  }
  return {
    mutation: "cartDeliveryAddressesAdd",
    cart: addPayload.cart ?? null,
    userErrors: addErrors,
    warnings: addPayload.warnings ?? [],
  };
}

export async function applyCheckoutDetailsToCart(params: {
  store: StorefrontStore;
  cartId: string;
  details: CartCheckoutDetails;
}): Promise<{ checkoutUrl: string }> {
  const deliveryAddressInput = buildSelectableDeliveryAddress(params.details);
  const sentAddress = deliveryAddressInput.address.deliveryAddress;

  console.log(LOG_PREFIX, "apply starting", {
    cartId: params.cartId,
    storeId: params.store.id,
    sent: {
      email: params.details.email,
      phone: params.details.phone,
      countryCode: params.details.countryCode,
      firstName: params.details.firstName,
      lastName: params.details.lastName,
      address1: params.details.address1,
      city: params.details.city,
      provinceCode: params.details.provinceCode,
      zip: params.details.zip,
      validationStrategy: deliveryAddressInput.validationStrategy,
      oneTimeUse: deliveryAddressInput.oneTimeUse,
      selected: deliveryAddressInput.selected,
    },
  });

  const addressResult = await applyDeliveryAddressToCart({
    store: params.store,
    cartId: params.cartId,
    addresses: [deliveryAddressInput],
  });

  console.log(LOG_PREFIX, "delivery address mutation result", {
    cartId: params.cartId,
    mutation: addressResult.mutation,
    userErrors: addressResult.userErrors,
    warnings: addressResult.warnings,
    cartSnapshot: summarizePrefillSnapshot(
      "after-delivery-mutation",
      snapshotDeliveryAddresses(addressResult.cart)
    ),
    sentAddress,
  });

  const identityData = await storefrontFetch<{
    cartBuyerIdentityUpdate: {
      cart: CartPrefillCart | null;
      userErrors: Array<{ field?: string[]; message: string }>;
      warnings: Array<{ message: string; code?: string; target?: string }>;
    } | null;
  }>(params.store, CART_BUYER_IDENTITY_UPDATE_MUTATION, {
    cartId: params.cartId,
    buyerIdentity: {
      email: params.details.email,
      phone: params.details.phone,
      countryCode: params.details.countryCode,
    },
  });

  const identityPayload = identityData?.cartBuyerIdentityUpdate;
  if (!identityPayload) {
    throw new Error("cartBuyerIdentityUpdate returned no payload");
  }

  const identityErrors = identityPayload.userErrors ?? [];
  console.log(LOG_PREFIX, "buyer identity mutation result", {
    cartId: params.cartId,
    userErrors: identityErrors,
    warnings: identityPayload.warnings ?? [],
    cartSnapshot: summarizePrefillSnapshot(
      "after-identity-mutation",
      snapshotDeliveryAddresses(identityPayload.cart)
    ),
  });

  if (identityErrors.length) {
    throw new Error(
      `Buyer identity: ${identityErrors.map((e) => e.message).join("; ")}`
    );
  }

  const verifiedSnapshot = await readCartCheckoutPrefill(params.store, params.cartId);
  if (verifiedSnapshot) {
    const summary = summarizePrefillSnapshot("verified-cart-query", verifiedSnapshot);
    console.log(LOG_PREFIX, "prefill verification", {
      cartId: params.cartId,
      ...summary,
      deliveryAddressStoredOnCart: hasDeliveryAddressOnCart(verifiedSnapshot),
      note:
        "If deliveryAddressStoredOnCart is true but Shopify checkout fields are empty, the store likely needs Checkout Extensibility for address prefill.",
    });
  }

  const cart = addressResult.cart ?? identityPayload.cart;
  if (!cart?.checkoutUrl) throw new Error("Checkout URL unavailable");

  const prefilledCheckoutUrl = buildPrefilledCheckoutUrl(cart.checkoutUrl, params.details);

  console.log(LOG_PREFIX, "apply complete", {
    cartId: params.cartId,
    checkoutUrl: prefilledCheckoutUrl,
    usedQueryParamPrefill: prefilledCheckoutUrl !== cart.checkoutUrl,
  });

  return { checkoutUrl: prefilledCheckoutUrl };
}

export async function getCartCheckoutUrl(params: {
  store: StorefrontStore;
  cartId: string;
}): Promise<{ checkoutUrl: string; totalPrice: string | null } | null> {
  return getCartSummary(params);
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
  }>(params.store, CART_CHECKOUT_URL_QUERY, { id: params.cartId }).catch((error) => {
    console.warn(LOG_PREFIX, "getCartSummary failed", {
      cartId: params.cartId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!data?.cart?.checkoutUrl) return null;
  return {
    checkoutUrl: data.cart.checkoutUrl,
    totalPrice: formatTotal(data.cart.cost),
  };
}

function mapCartLines(
  edges: Array<{
    node: {
      id: string;
      quantity: number;
      merchandise: {
        title?: string;
        price?: { amount: string; currencyCode: string };
        product?: { title: string };
      };
    };
  }>
): CartLineItem[] {
  const lines: CartLineItem[] = [];
  for (const { node } of edges) {
    const merchandise = node.merchandise;
    if (!node.id || !merchandise?.title || !merchandise.price?.amount || !merchandise.product?.title) {
      continue;
    }
    lines.push({
      id: node.id,
      title: merchandise.product.title,
      variantTitle: merchandise.title,
      quantity: node.quantity,
      price: merchandise.price.amount,
      currency: merchandise.price.currencyCode,
    });
  }
  return lines;
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
            id: string;
            quantity: number;
            merchandise: {
              title?: string;
              price?: { amount: string; currencyCode: string };
              product?: { title: string };
            };
          };
        }>;
      } | null;
    } | null;
  }>(params.store, CART_WITH_LINES_QUERY, { id: params.cartId }).catch((error) => {
    console.warn(LOG_PREFIX, "getCartWithLines failed", {
      cartId: params.cartId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!data?.cart?.checkoutUrl) return null;

  const lines = mapCartLines(data.cart.lines?.edges ?? []);

  return {
    checkoutUrl: data.cart.checkoutUrl,
    totalPrice: formatTotal(data.cart.cost),
    lines,
  };
}

export function toCartSummary(cart: CartSummaryWithLines): CartSummary {
  const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    itemCount,
    total: cart.totalPrice,
    checkoutUrl: cart.checkoutUrl,
    lines: cart.lines,
  };
}

export async function cartLinesRemove(params: {
  store: StorefrontStore;
  cartId: string;
  lineIds: string[];
}): Promise<{ cartId: string; checkoutUrl: string; totalPrice: string | null }> {
  if (!params.lineIds.length) {
    throw new Error("No cart lines to remove");
  }

  const data = await storefrontFetch<{
    cartLinesRemove: {
      cart: {
        id: string;
        checkoutUrl: string;
        cost: { totalAmount: { amount: string; currencyCode: string } };
      } | null;
      userErrors: Array<{ message: string }>;
    } | null;
  }>(params.store, CART_LINES_REMOVE_MUTATION, {
    cartId: params.cartId,
    lineIds: params.lineIds,
  });

  const payload = data?.cartLinesRemove;
  if (!payload) throw new Error("cartLinesRemove returned no payload");
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length) throw new Error(userErrors[0]?.message ?? "Cart line removal failed");
  if (!payload.cart) throw new Error("Cart line removal failed");

  return {
    cartId: payload.cart.id,
    checkoutUrl: payload.cart.checkoutUrl,
    totalPrice: formatTotal(payload.cart.cost),
  };
}
