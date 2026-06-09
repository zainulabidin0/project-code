import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductSuggestionLabel,
  filterProductsBySearchRelevance,
  isBrowseAlternativesRequest,
  isConfirmYes,
  isDirectCartAddRequest,
  isProductRelevantToQuery,
  parseRequestedQuantity,
  productsForDisplay,
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

test("parseRequestedQuantity extracts piece counts", () => {
  assert.equal(parseRequestedQuantity("mujhe iss k 2 piece buy krne hn"), 2);
  assert.equal(parseRequestedQuantity("3 pcs please"), 3);
  assert.equal(parseRequestedQuantity("just one"), undefined);
});

test("productsForDisplay returns products only when opted in", () => {
  const mesh = sampleProducts[0];
  const lighter = sampleProducts[1];
  assert.equal(productsForDisplay([lighter, mesh], false).length, 0);
  const displayed = productsForDisplay([mesh], true);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].title, "Lemon Body Wax");
});

test("isDirectCartAddRequest detects explicit add commands", () => {
  assert.equal(isDirectCartAddRequest("Add 2 pieces please"), true);
  assert.equal(isDirectCartAddRequest("add to cart"), true);
  assert.equal(isDirectCartAddRequest("yes"), true);
  assert.equal(isDirectCartAddRequest("mujhe 2 piece buy krne hn"), true);
  assert.equal(isDirectCartAddRequest("I want to browse"), false);
});
test("isBrowseAlternativesRequest detects explicit browse phrases only", () => {
  assert.equal(isBrowseAlternativesRequest("sure"), false);
  assert.equal(isBrowseAlternativesRequest("yes"), false);
  assert.equal(isBrowseAlternativesRequest("show me what else you have"), true);
  assert.equal(isBrowseAlternativesRequest("candle wax"), false);
});

test("filterProductsBySearchRelevance rejects unrelated Shopify false positives", () => {
  const meshNebulizer: ShopifyProduct = {
    ...sampleProducts[0],
    title: "Portable Mesh Nebulizer | Roschic Portable Mesh Nebulizer",
    description: "Portable mesh nebulizer for respiratory care",
  };

  assert.equal(isProductRelevantToQuery(meshNebulizer, "butterflies"), false);
  assert.equal(filterProductsBySearchRelevance([meshNebulizer], "butterflies").length, 0);
  assert.equal(isProductRelevantToQuery(sampleProducts[0], "lemon wax"), true);
  assert.equal(filterProductsBySearchRelevance([sampleProducts[0]], "lemon wax").length, 1);
});

test("productsForDisplay ignores cached session products when not opted in", () => {
  assert.equal(productsForDisplay(sampleProducts, false).length, 0);
});
