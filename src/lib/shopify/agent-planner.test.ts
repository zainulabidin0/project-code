import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackPlan, inferSortHints, normalizeShopifyQuery, parseIntent } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";
import { isConfirmYes, resolveProductSelection } from "@/lib/shopify/product-selection";
import type { ShopifyProduct } from "@/lib/shopify/types";

test("normalizeShopifyQuery removes filler words and punctuation", () => {
  const normalized = normalizeShopifyQuery("Show me some NEW products, please?");
  assert.equal(normalized, "new");
});

test("inferSortHints maps latest intent to created_at descending", () => {
  const hints = inferSortHints("show latest products");
  assert.equal(hints.sortKey, "CREATED_AT");
  assert.equal(hints.reverse, true);
});

test("buildFallbackPlan generates product_search plan with query", () => {
  const plan = buildFallbackPlan("Show me soaps under 50");
  assert.equal(plan.intent, "product_search");
  assert.equal(plan.needsClarification, false);
  assert.ok(plan.shopifyQuery && plan.shopifyQuery.length > 0);
});

test("recoverSearchPlan falls back to rule-based clarification or rewrite when llm unavailable", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const result = await recoverSearchPlan({
      userMessage: "Show latest products",
      initialPlan: buildFallbackPlan("Show latest products"),
      failedQuery: "show latest products?",
      errorMessage: "Shopify API error: 400",
    });
    assert.equal(result.status, "rewritten");
    if (result.status === "rewritten") {
      assert.equal(result.plan.sortKey, "CREATED_AT");
      assert.equal(result.plan.reverse, true);
    }
  } finally {
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  }
});

const waxProducts: ShopifyProduct[] = [
  {
    id: "gid://shopify/Product/1",
    title: "Lemon Body Wax",
    price: "12.00",
    currency: "USD",
    image: null,
    url: "/products/lemon-wax",
    variants: [{ id: "gid://shopify/ProductVariant/101", title: "Default", available: true, options: [] }],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Honey Wax",
    price: "15.00",
    currency: "USD",
    image: null,
    url: "/products/honey-wax",
    variants: [{ id: "gid://shopify/ProductVariant/102", title: "Default", available: true, options: [] }],
  },
];

test("parseIntent rule-based confirm_add_to_cart when awaiting confirm", async () => {
  const intent = await parseIntent("yes please", {
    history: [
      { role: "user", content: "wax" },
      { role: "assistant", content: "Which one?" },
    ],
    context: {
      stage: "awaiting_confirm",
      selectedProduct: waxProducts[0],
      selectedVariantId: "gid://shopify/ProductVariant/101",
    },
  });
  assert.equal(intent.intent, "confirm_add_to_cart");
  assert.equal(intent.variantId, "gid://shopify/ProductVariant/101");
});

test("parseIntent rule-based select_product from presenting options", async () => {
  const intent = await parseIntent("lemon wax", {
    history: [{ role: "user", content: "wax" }],
    context: {
      stage: "presenting_options",
      lastProducts: waxProducts,
    },
  });
  assert.equal(intent.intent, "select_product");
  assert.equal(intent.variantId, "gid://shopify/ProductVariant/101");
});

test("parseIntent rule-based browse_alternatives after no_results", async () => {
  const intent = await parseIntent("sure show me what else you have", {
    history: [
      { role: "user", content: "wax" },
      { role: "assistant", content: "We don't sell wax." },
    ],
    context: {
      stage: "no_results",
      lastSearchQuery: "wax",
    },
  });
  assert.equal(intent.intent, "browse_alternatives");
  assert.equal(intent.needsClarification, false);
});
test("parseIntent routes add 2 pieces to confirm_add_to_cart", async () => {
  const intent = await parseIntent("Add 2 pieces please", {
    history: [],
    context: {
      stage: "awaiting_confirm",
      selectedProduct: waxProducts[0],
      selectedVariantId: "gid://shopify/ProductVariant/101",
      selectedQuantity: 2,
    },
  });
  assert.equal(intent.intent, "confirm_add_to_cart");
  assert.equal(intent.quantity, 2);
  assert.equal(intent.variantId, "gid://shopify/ProductVariant/101");
});

test("isConfirmYes and resolveProductSelection integrate for salesman flow", () => {
  assert.equal(isConfirmYes("yeah add it"), true);
  const pick = resolveProductSelection("the honey one", waxProducts);
  assert.ok(pick);
  assert.equal(pick.product.title, "Honey Wax");
});
