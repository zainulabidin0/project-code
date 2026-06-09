import assert from "node:assert/strict";
import test from "node:test";
import { chunkTextForTts, detectTtsLanguage } from "@/lib/shopify/tts";

test("chunkTextForTts keeps short text in one chunk", () => {
  assert.deepEqual(chunkTextForTts("Hello there."), ["Hello there."]);
});

test("chunkTextForTts splits long assistant replies under 200 chars", () => {
  const long =
    "Here are our newest arrivals from the store catalog. " +
    "We have several great options for you to choose from today, including wax kits, nebulizers, and accessories. " +
    "Let me know which product interests you most and I can add it to your cart or help you compare prices.";
  const chunks = chunkTextForTts(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 200);
  }
});

test("detectTtsLanguage picks Arabic when Arabic script is present", () => {
  assert.equal(detectTtsLanguage("show me wax"), "en");
  assert.equal(detectTtsLanguage("مرا کارٹ دکھاؤ"), "ar");
});
