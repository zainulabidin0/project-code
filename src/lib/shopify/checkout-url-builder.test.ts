import assert from "node:assert/strict";
import test from "node:test";
import { buildCheckoutUrl, getMissingFields, normalizePhone } from "./checkout-url-builder";

const BASE = "https://store.myshopify.com/checkouts/cn/abc123";

test("normalizePhone normalizes Pakistani mobile formats", () => {
  assert.equal(normalizePhone("03001234567"), "+923001234567");
  assert.equal(normalizePhone("3001234567"), "+923001234567");
  assert.equal(normalizePhone("+923001234567"), "+923001234567");
});

test("getMissingFields requires core checkout fields but not province", () => {
  assert.deepEqual(
    getMissingFields({
      fullName: "Ali Khan",
      email: "ali@gmail.com",
      phone: "03001234567",
      address1: "House 5",
      city: "Karachi",
    }),
    ["zip"]
  );
});

test("buildCheckoutUrl builds a prefilled checkout URL with encoded params", () => {
  const url = buildCheckoutUrl(BASE, {
    fullName: "Ali Khan",
    email: "ali@gmail.com",
    phone: "03001234567",
    address1: "House 5, Block A, Gulshan",
    city: "Karachi",
    zip: "75500",
    country: "PK",
  });

  assert.match(url, /checkout%5Bemail%5D=ali%40gmail.com/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bfirst_name%5D=Ali/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Blast_name%5D=Khan/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bphone%5D=%2B923001234567/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bcity%5D=Karachi/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bprovince%5D=SD/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bzip%5D=75500/);
  assert.match(url, /checkout%5Bshipping_address%5D%5Bcountry%5D=PK/);
});

test("buildCheckoutUrl appends to existing query params", () => {
  const url = buildCheckoutUrl(`${BASE}?locale=en-pk`, {
    email: "ali@gmail.com",
    fullName: "Ali",
    phone: "03001234567",
    address1: "House 5",
    city: "Karachi",
    zip: "75500",
  });
  assert.ok(url.startsWith(`${BASE}?locale=en-pk&`));
});
