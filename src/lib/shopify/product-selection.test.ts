import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductSuggestionLabel,
  isConfirmYes,
  isVagueGreeting,
  resolveProductSelection,
} from "@/lib/shopify/product-selection";
import type { ShopifyProduct } from "@/lib/shopify/types";

const sampleProducts: ShopifyProduct[] = [
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
  {
    id: "gid://shopify/Product/3",
    title: "Hard Wax Kit",
    price: "20.00",
    currency: "USD",
    image: null,
    url: "/products/hard-wax",
    variants: [
      { id: "gid://shopify/ProductVariant/103", title: "Small", available: true, options: [{ name: "Size", value: "Small" }] },
      { id: "gid://shopify/ProductVariant/104", title: "Large", available: true, options: [{ name: "Size", value: "Large" }] },
    ],
  },
];

test("resolveProductSelection matches by ordinal", () => {
  const result = resolveProductSelection("I'll take the second one", sampleProducts);
  assert.ok(result);
  assert.equal(result.product.title, "Honey Wax");
  assert.equal(result.productIndex, 1);
});

test("resolveProductSelection matches by title keyword", () => {
  const result = resolveProductSelection("lemon wax please", sampleProducts);
  assert.ok(result);
  assert.equal(result.product.title, "Lemon Body Wax");
  assert.equal(result.variantId, "gid://shopify/ProductVariant/101");
});

test("resolveProductSelection matches chip label", () => {
  const label = buildProductSuggestionLabel(sampleProducts[0]);
  const result = resolveProductSelection(label, sampleProducts);
  assert.ok(result);
  assert.equal(result.product.title, "Lemon Body Wax");
});

test("resolveProductSelection flags multi-variant products", () => {
  const result = resolveProductSelection("hard wax kit", sampleProducts);
  assert.ok(result);
  assert.equal(result.product.title, "Hard Wax Kit");
  assert.equal(result.needsVariantChoice, true);
  assert.equal(result.variantId, undefined);
});

test("resolveProductSelection returns null when no match", () => {
  const result = resolveProductSelection("something random xyz", sampleProducts);
  assert.equal(result, null);
});

test("isConfirmYes detects affirmative replies", () => {
  assert.equal(isConfirmYes("yes"), true);
  assert.equal(isConfirmYes("Yeah add it"), true);
  assert.equal(isConfirmYes("no thanks"), false);
});

test("isVagueGreeting detects greetings", () => {
  assert.equal(isVagueGreeting("Hi"), true);
  assert.equal(isVagueGreeting("hello!"), true);
  assert.equal(isVagueGreeting("wax"), false);
});
