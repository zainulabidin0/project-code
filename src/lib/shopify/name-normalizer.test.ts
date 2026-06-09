import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlausibleFullName,
  looksConversationalFullName,
  normalizeFullNameInput,
  stripConversationalNamePrefix,
} from "@/lib/shopify/name-normalizer";

test("stripConversationalNamePrefix removes common phrases", () => {
  assert.equal(stripConversationalNamePrefix("My name is Abuburr."), "Abuburr");
  assert.equal(stripConversationalNamePrefix("I am Ali Khan"), "Ali Khan");
  assert.equal(stripConversationalNamePrefix("mera naam Hassan hai"), "Hassan");
});

test("looksConversationalFullName detects sentence-style replies", () => {
  assert.equal(looksConversationalFullName("My name is Abuburr."), true);
  assert.equal(looksConversationalFullName("Ali Khan"), false);
});

test("isPlausibleFullName rejects filler-heavy strings", () => {
  assert.equal(isPlausibleFullName("Abuburr"), true);
  assert.equal(isPlausibleFullName("Ali Khan"), true);
  assert.equal(isPlausibleFullName("My name is"), false);
  assert.equal(isPlausibleFullName("name is Abuburr"), false);
});

test("normalizeFullNameInput uses rules for clean names without Groq", async () => {
  const result = await normalizeFullNameInput("Ali Khan");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.fullName, "Ali Khan");
});

test("normalizeFullNameInput normalizes conversational names with rules when plausible", async () => {
  const result = await normalizeFullNameInput("call me Zain");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.fullName, "Zain");
});

test("normalizeFullNameInput fixes my name is replies without Groq", async () => {
  const result = await normalizeFullNameInput("My name is Abuburr.");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.fullName, "Abuburr");
});
