export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

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

export type AgentIntent =
  | "product_search"
  | "add_to_cart"
  | "show_cart"
  | "start_checkout"
  | "chitchat";

export type AgentResponse = {
  message: string;
  intent: AgentIntent;
  query?: string;
  variantId?: string;
};
