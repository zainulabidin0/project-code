import type { StorefrontStore } from "@/lib/shopify/storefront";

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SearchSortKey = "RELEVANCE" | "CREATED_AT" | "PRICE" | "BEST_SELLING";

export type ShopifyProduct = {
  id: string;
  title: string;
  description?: string;
  price: string;
  currency: string;
  image: string | null;
  url: string;
  variants: Array<{
    id: string;
    title: string;
    available: boolean;
    options: Array<{ name: string; value: string }>;
  }>;
};

export type CartLineItem = {
  id: string;
  title: string;
  variantTitle: string;
  quantity: number;
  price: string;
  currency: string;
};

export type CartSummaryWithLines = {
  checkoutUrl: string;
  totalPrice: string | null;
  lines: CartLineItem[];
};

export type CartSummary = {
  itemCount: number;
  total: string | null;
  checkoutUrl: string;
  lines: CartLineItem[];
};

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

export type CheckoutField =
  | "fullName"
  | "email"
  | "phone"
  | "address1"
  | "address2"
  | "city"
  | "province"
  | "zip";

export type CartAction = {
  checkoutUrl: string;
  totalPrice: string | null;
  cartId?: string;
};

export type LastAddedProduct = {
  title: string;
  price: string;
  quantity: number;
};

/** Persisted session state (no runtime-only fields). */
export type ChatSessionContext = {
  checkoutDraft?: CheckoutDraft;
  cartAction?: CartAction | null;
  checkoutReady?: boolean;
  cartSummary?: CartSummary | null;
  lastAddedProduct?: LastAddedProduct | null;
};

/** Runtime agent context (storefrontStore and storeId are not persisted). */
export type AgentContext = {
  cartId: string | null;
  checkoutDraft: CheckoutDraft;
  checkoutReady: boolean;
  cartAction: CartAction | null;
  cartSummary: CartSummary | null;
  lastSearchProducts: ShopifyProduct[];
  lastAddedProduct: LastAddedProduct | null;
  storefrontStore: StorefrontStore;
  storeId: string;
};
