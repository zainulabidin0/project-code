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
  assert.equal(payload.address.deliveryAddress.provinceCode, "PB");
  assert.equal(payload.address.deliveryAddress.city, "Lahore");
  assert.equal(payload.address.deliveryAddress.phone, "+923001234567");
  assert.equal(payload.validationStrategy, "COUNTRY_CODE_ONLY");
});

test("normalizeProvinceCode maps cities and province names for Pakistan", () => {
  assert.equal(normalizeProvinceCode("Punjab"), "PB");
  assert.equal(normalizeProvinceCode("Lahore"), "PB");
  assert.equal(normalizeProvinceCode("", "Karachi"), "SD");
  assert.equal(normalizeProvinceCode("Sindh", "Karachi"), "SD");
});

test("normalizeZipForPakistan uses province default when zip is invalid", () => {
  assert.equal(normalizeZipForPakistan("54000", "PB"), "54000");
  assert.equal(normalizeZipForPakistan("bad", "SD"), "75000");
});

test("toCartCheckoutDetails infers province from city", () => {
  const details = toCartCheckoutDetails({
    countryCode: "PK",
    fullName: "Kain",
    email: "kain@gmail.com",
    phone: "03001234567",
    address1: "House 12 Street 5",
    city: "Lahore",
    province: "Lahore",
    zip: "54000",
  });
  assert.equal(details.provinceCode, "PB");
  assert.equal(details.lastName, "Kain");
});

test("splitFullName handles single and multi part names", () => {
  assert.deepEqual(splitFullName("Ali"), { firstName: "Ali", lastName: "Ali" });
  assert.deepEqual(splitFullName("Ali Khan"), { firstName: "Ali", lastName: "Khan" });
});

test("buildPrefilledCheckoutUrl appends checkout query params", () => {
  const base =
    "https://my-cart-10001.myshopify.com/checkouts/cn/hWND4oVlkI3PmqJOaaLRrW0Q/en-pk";
  const url = buildPrefilledCheckoutUrl(base, {
    email: "test@gmail.com",
    firstName: "Ali",
    lastName: "Khan",
    phone: "+923001234567",
    city: "Karachi",
    zip: "75500",
    countryCode: "PK",
    address1: "House 127/E Block",
    provinceCode: "SD",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("checkout[email]"), "test@gmail.com");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][first_name]"), "Ali");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][last_name]"), "Khan");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][phone]"), "+923001234567");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][city]"), "Karachi");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][zip]"), "75500");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][country]"), "PK");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][address1]"), "House 127/E Block");
  assert.equal(parsed.searchParams.get("checkout[shipping_address][province]"), "SD");
});
