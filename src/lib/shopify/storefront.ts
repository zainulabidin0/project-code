import type { ShopifyProduct } from "@/lib/shopify/types";

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
    cart { id checkoutUrl }
    userErrors { field message }
  }
}
`;

const CART_LINES_ADD_MUTATION = `
mutation AddCartLines($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) {
    cart { id checkoutUrl }
    userErrors { field message }
  }
}
`;

async function storefrontFetch<T>(
  shopDomain: string,
  storefrontToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://${shopDomain}/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error("Storefront request failed");
  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "Storefront GraphQL error");
  if (!json.data) throw new Error("Missing Storefront response data");
  return json.data;
}

export async function searchProducts(
  shopDomain: string,
  storefrontToken: string,
  query: string
): Promise<ShopifyProduct[]> {
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
          variants: { edges: Array<{ node: { id: string; title: string; availableForSale: boolean } }> };
        };
      }>;
    };
  }>(shopDomain, storefrontToken, PRODUCT_SEARCH_QUERY, { query, first: 5 });

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
    })),
  }));
}

export async function addToCart(params: {
  shopDomain: string;
  storefrontToken: string;
  variantId: string;
  quantity: number;
  cartId?: string | null;
}): Promise<{ cartId: string; checkoutUrl: string }> {
  const lines = [{ merchandiseId: params.variantId, quantity: params.quantity }];
  if (params.cartId) {
    const data = await storefrontFetch<{
      cartLinesAdd: {
        cart: { id: string; checkoutUrl: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(params.shopDomain, params.storefrontToken, CART_LINES_ADD_MUTATION, { cartId: params.cartId, lines });
    if (data.cartLinesAdd.userErrors.length) throw new Error(data.cartLinesAdd.userErrors[0].message);
    if (!data.cartLinesAdd.cart) throw new Error("Cart update failed");
    return { cartId: data.cartLinesAdd.cart.id, checkoutUrl: data.cartLinesAdd.cart.checkoutUrl };
  }

  const data = await storefrontFetch<{
    cartCreate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(params.shopDomain, params.storefrontToken, CART_CREATE_MUTATION, { lines });
  if (data.cartCreate.userErrors.length) throw new Error(data.cartCreate.userErrors[0].message);
  if (!data.cartCreate.cart) throw new Error("Cart creation failed");
  return { cartId: data.cartCreate.cart.id, checkoutUrl: data.cartCreate.cart.checkoutUrl };
}
