export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SearchSortKey = "RELEVANCE" | "CREATED_AT" | "PRICE" | "BEST_SELLING";
export type IntentConfidence = "low" | "medium" | "high";

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

export type ConversationStage =
  | "greeting"
  | "no_results"
  | "presenting_options"
  | "selecting_variant"
  | "awaiting_quantity"
  | "awaiting_cart_confirm"
  | "awaiting_confirm"
  | "cart_added_pause"
  | "collecting_checkout"
  | "checkout_ready"
  | "completed";

export type CartLineItem = {
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

export type ChatSessionContext = {
  stage: ConversationStage;
  lastProducts?: ShopifyProduct[];
  selectedProduct?: ShopifyProduct;
  selectedVariantId?: string;
  selectedQuantity?: number;
  lastSearchQuery?: string;
  checkoutDraft?: CheckoutDraft;
  checkoutField?: CheckoutField;
};

export type AgentIntent =
  | "product_search"
  | "browse_alternatives"
  | "select_product"
  | "confirm_add_to_cart"
  | "add_to_cart"
  | "show_cart"
  | "start_checkout"
  | "chitchat"
  | "off_topic";

export type AgentResponse = {
  message: string;
  intent: AgentIntent;
  query?: string;
  variantId?: string;
};

export type ClarificationPayload = {
  question: string;
  suggestions: string[];
};

export type ShopAssistActionPlan = {
  intent: AgentIntent;
  shopifyQuery?: string;
  sortKey?: SearchSortKey;
  reverse?: boolean;
  variantId?: string;
  productIndex?: number;
  productTitle?: string;
  quantity?: number;
  confidence: IntentConfidence;
  needsClarification: boolean;
  clarification?: ClarificationPayload;
};

export type QueryRecoveryResult =
  | {
      status: "rewritten";
      plan: ShopAssistActionPlan;
      reason: string;
    }
  | {
      status: "clarification";
      clarification: ClarificationPayload;
      reason: string;
    };
