import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCheckoutAnswer,
  buildSelectableDeliveryAddress,
  createInitialCheckoutDraft,
  getNextCheckoutField,
  isCheckoutIntent,
  parseCheckoutAnswer,
  processCheckoutAnswer,
  splitFullName,
  toCartCheckoutDetails,
} from "@/lib/shopify/checkout-collector";

test("checkout field order starts with full name", () => {
  const draft = createInitialCheckoutDraft();
  assert.equal(getNextCheckoutField(draft), "fullName");
});

test("isCheckoutIntent detects checkout requests", () => {
  assert.equal(isCheckoutIntent("I want to checkout"), true);
  assert.equal(isCheckoutIntent("show me wax"), false);
});

test("processCheckoutAnswer advances through fields", () => {
  let draft = createInitialCheckoutDraft();
  const step = processCheckoutAnswer(draft, "fullName", "Ali Khan");
  assert.equal(step.status, "next");
  if (step.status === "next") {
    assert.equal(step.field, "email");
    draft = step.draft;
  }
  const emailStep = processCheckoutAnswer(draft, "email", "ali@example.com");
  assert.equal(emailStep.status, "next");
  if (emailStep.status === "next") {
    assert.equal(emailStep.field, "phone");
  }
});

test("parseCheckoutAnswer validates email", () => {
  assert.equal(parseCheckoutAnswer("email", "bad").ok, false);
  assert.equal(parseCheckoutAnswer("email", "good@test.com").ok, true);
});

test("address2 can be skipped", () => {
  const parsed = parseCheckoutAnswer("address2", "skip");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const draft = applyCheckoutAnswer(createInitialCheckoutDraft(), "address2", parsed.value);
    assert.equal(draft.address2, "");
  }
});

test("buildSelectableDeliveryAddress nests fields under deliveryAddress", () => {
  const details = toCartCheckoutDetails({
    countryCode: "PK",
    fullName: "Ali Khan",
    email: "ali@test.com",
    phone: "03001234567",
    address1: "123 Main St",
    address2: "",
    city: "Lahore",
    province: "Punjab",
    zip: "54000",
  });
  const payload = buildSelectableDeliveryAddress(details);
  assert.equal(payload.address.deliveryAddress.firstName, "Ali");
  assert.equal(payload.address.deliveryAddress.city, "Lahore");
  assert.equal(payload.address.deliveryAddress.phone, "+923001234567");
});

test("splitFullName handles single and multi part names", () => {
  assert.deepEqual(splitFullName("Ali"), { firstName: "Ali", lastName: "" });
  assert.deepEqual(splitFullName("Ali Khan"), { firstName: "Ali", lastName: "Khan" });
});
