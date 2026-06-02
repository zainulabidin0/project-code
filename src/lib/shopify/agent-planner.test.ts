import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackPlan, inferSortHints, normalizeShopifyQuery } from "@/lib/shopify/intent-parser";
import { recoverSearchPlan } from "@/lib/shopify/query-recovery";

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
