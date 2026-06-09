import assert from "node:assert/strict";
import test from "node:test";
import { matchCityInAddress } from "@/lib/courier/city-matcher";
import { fixtureLeopardsCard, fixtureTcsCard } from "@/lib/courier/fixtures.test-data";
import {
  compareCouriers,
  loadRateCards,
  loadRateCardsForTest,
  resetRateCardCache,
} from "@/lib/courier/compare-engine";

const cities = fixtureTcsCard.cities;

test("matchCityInAddress resolves alias and exact city names", () => {
  const khi = matchCityInAddress("Plot 12, Saddar, Karachi", cities);
  assert.equal(khi.ok, true);
  if (khi.ok) {
    assert.equal(khi.city.name, "Karachi");
    assert.equal(khi.confidence, "exact");
  }

  const alias = matchCityInAddress("Warehouse, KHI", cities);
  assert.equal(alias.ok, true);
  if (alias.ok) {
    assert.equal(alias.city.name, "Karachi");
    assert.equal(alias.confidence, "alias");
  }
});

test("matchCityInAddress returns unresolved for unknown city", () => {
  const result = matchCityInAddress("Some street, Atlantis", cities);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unresolved");
    assert.ok(result.suggestedCities.length > 0);
  }
});

test("matchCityInAddress flags ambiguous multi-city addresses", () => {
  const result = matchCityInAddress("Karachi to Lahore warehouse", cities);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "ambiguous");
    assert.deepEqual(result.suggestedCities.sort(), ["Karachi", "Lahore"]);
  }
});

test("compareCouriers picks cheaper carrier on metro route", () => {
  loadRateCardsForTest(fixtureTcsCard, fixtureLeopardsCard);
  const result = compareCouriers({
    fromAddress: "Karachi",
    toAddress: "Lahore",
    weightKg: 1,
  });
  assert.equal(result.recommended, "leopards");
  assert.equal(result.quotes.leopards.totalPrice, 170);
  assert.equal(result.quotes.tcs.totalPrice, 280);
  resetRateCardCache();
});

test("compareCouriers prefers TCS for remote destination without Leopards coverage", () => {
  loadRateCardsForTest(fixtureTcsCard, fixtureLeopardsCard);
  const result = compareCouriers({
    fromAddress: "Karachi",
    toAddress: "Skardu",
    weightKg: 1,
  });
  assert.equal(result.recommended, "tcs");
  assert.equal(result.quotes.leopards.coverage, "unsupported");
  assert.equal(result.quotes.tcs.totalPrice, 550);
  resetRateCardCache();
});

test("matchCityInAddress resolves newly added tier-2 cities", () => {
  const { tcs } = loadRateCards();
  const gujrat = matchCityInAddress("Main Bazaar, Gujrat", tcs.cities);
  assert.equal(gujrat.ok, true);
  if (gujrat.ok) assert.equal(gujrat.city.name, "Gujrat");

  const larkana = matchCityInAddress("Station Road, Larkana", tcs.cities);
  assert.equal(larkana.ok, true);
  if (larkana.ok) assert.equal(larkana.city.name, "Larkana");
});

test("compareCouriers includes COD fees in totals", () => {
  loadRateCardsForTest(fixtureTcsCard, fixtureLeopardsCard);
  const result = compareCouriers({
    fromAddress: "Karachi",
    toAddress: "Lahore",
    weightKg: 1,
    codAmount: 3000,
  });
  assert.equal(result.quotes.leopards.totalPrice, 170 + 60);
  assert.equal(result.quotes.tcs.totalPrice, 280 + 75);
  assert.equal(result.recommended, "leopards");
  resetRateCardCache();
});
