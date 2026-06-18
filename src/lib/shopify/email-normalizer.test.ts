import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEmailInput,
  normalizeSpokenEmail,
} from "@/lib/shopify/email-normalizer";

test("normalizeSpokenEmail converts at and dot patterns", () => {
  assert.equal(normalizeSpokenEmail("zain at gmail"), "zain@gmail.com");
  assert.equal(normalizeSpokenEmail("zain at the rate gmail"), "zain@gmail.com");
  assert.equal(normalizeSpokenEmail("zain at the rate gmail dot com"), "zain@gmail.com");
  assert.equal(normalizeSpokenEmail("zain at gmail dot com"), "zain@gmail.com");
  assert.equal(normalizeSpokenEmail("zain@gmail.com"), "zain@gmail.com");
});

test("normalizeSpokenEmail strips conversational prefixes", () => {
  assert.equal(normalizeSpokenEmail("my email is zain at gmail"), "zain@gmail.com");
  assert.equal(normalizeSpokenEmail("email is ali at yahoo dot com"), "ali@yahoo.com");
});

test("normalizeEmailInput validates normalized emails", () => {
  assert.deepEqual(normalizeEmailInput("zain at gmail"), {
    ok: true,
    email: "zain@gmail.com",
  });
  assert.equal(normalizeEmailInput("hello world").ok, false);
  assert.equal(normalizeEmailInput("zain at").ok, false);
});
