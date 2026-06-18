import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCheckoutAnswer,
  buildPrefilledCheckoutUrl,
  buildSelectableDeliveryAddress,
  createInitialCheckoutDraft,
  getNextCheckoutField,
  isCheckoutIntent,
  normalizeProvinceCode,
  normalizeZipForPakistan,
  parseCheckoutAnswer,
  splitFullName,
  toCartCheckoutDetails,
} from "@/lib/shopify/checkout-collector";

test("checkout field order starts with full name", () => {
  const draft = createInitialCheckoutDraft();
  assert.equal(getNextCheckoutField(draft), "fullName");
});

test("isCheckoutIntent detects checkout requests", () => {
  assert.equal(isCheckoutIntent("I want to checkout"), true);
  assert.equal(isCheckoutIntent("let's checkout"), true);
  assert.equal(isCheckoutIntent("lets go to checkout"), true);
  assert.equal(isCheckoutIntent("take me to checkout"), true);
  assert.equal(isCheckoutIntent("show me wax"), false);
});

test("applyCheckoutAnswer advances through fields", () => {
  let draft = createInitialCheckoutDraft();
  const nameParsed = parseCheckoutAnswer("fullName", "Ali Khan");
  assert.equal(nameParsed.ok, true);
  if (nameParsed.ok) {
    draft = applyCheckoutAnswer(draft, "fullName", nameParsed.value);
    assert.equal(getNextCheckoutField(draft), "email");
  }

  const emailParsed = parseCheckoutAnswer("email", "zain at gmail");
  assert.equal(emailParsed.ok, true);
  if (emailParsed.ok) {
    draft = applyCheckoutAnswer(draft, "email", emailParsed.value);
    assert.equal(getNextCheckoutField(draft), "phone");
    assert.equal(draft.email, "zain@gmail.com");
  }
});

test("parseCheckoutAnswer normalizes spoken email", () => {
  const parsed = parseCheckoutAnswer("email", "zain at the rate gmail dot com");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value, "zain@gmail.com");
  }
});

test("splitFullName handles single and multi-part names", () => {
  assert.deepEqual(splitFullName("Ali"), { firstName: "Ali", lastName: "Ali" });
  assert.deepEqual(splitFullName("Ali Khan"), { firstName: "Ali", lastName: "Khan" });
});

test("normalizeProvinceCode maps cities and provinces", () => {
  assert.equal(normalizeProvinceCode("Punjab"), "PB");
  assert.equal(normalizeProvinceCode("", "Lahore"), "PB");
  assert.equal(normalizeProvinceCode("", "Karachi"), "SD");
});

test("normalizeZipForPakistan fills default when invalid", () => {
  assert.equal(normalizeZipForPakistan("54000", "PB"), "54000");
  assert.equal(normalizeZipForPakistan("abc", "PB"), "54000");
});

test("toCartCheckoutDetails builds Shopify payload", () => {
  const details = toCartCheckoutDetails({
    fullName: "Ali Khan",
    email: "ali@test.com",
    phone: "03001234567",
    address1: "123 Main St",
    city: "Lahore",
    province: "Punjab",
    zip: "54000",
    countryCode: "PK",
  });
  assert.equal(details.firstName, "Ali");
  assert.equal(details.lastName, "Khan");
  assert.equal(details.provinceCode, "PB");
  assert.equal(details.countryCode, "PK");
});

test("buildPrefilledCheckoutUrl appends checkout params", () => {
  const url = buildPrefilledCheckoutUrl("https://shop.example.com/checkouts/cn/abc", {
    email: "ali@test.com",
    firstName: "Ali",
    lastName: "Khan",
    address1: "123 Main",
    city: "Lahore",
    provinceCode: "PB",
    countryCode: "PK",
    zip: "54000",
    phone: "+923001234567",
  });
  assert.ok(url.includes("checkout%5Bemail%5D=ali%40test.com"));
  assert.ok(url.includes("checkout%5Bshipping_address%5D%5Bcity%5D=Lahore"));
});

test("buildSelectableDeliveryAddress wraps delivery address", () => {
  const payload = buildSelectableDeliveryAddress({
    firstName: "Ali",
    lastName: "Khan",
    address1: "123 Main",
    city: "Lahore",
    provinceCode: "PB",
    zip: "54000",
    countryCode: "PK",
    phone: "+923001234567",
  });
  assert.equal(payload.selected, true);
  assert.equal(payload.address.deliveryAddress.city, "Lahore");
});
