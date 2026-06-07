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
  | "presenting_options"
  | "awaiting_confirm"
  | "completed";

export type ChatSessionContext = {
  stage: ConversationStage;
  lastProducts?: ShopifyProduct[];
  selectedProduct?: ShopifyProduct;
  selectedVariantId?: string;
  lastSearchQuery?: string;
};

export type AgentIntent =
  | "product_search"
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
