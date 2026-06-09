import tcsRates from "./data/tcs-rates.json";
import leopardsRates from "./data/leopards-rates.json";
import {
  CityMatchError,
  matchCityInAddress,
  mergeCityLists,
} from "./city-matcher";
import { quoteCarrier } from "./quote";
import type {
  CarrierQuote,
  CarrierRateCard,
  CompareResult,
  CourierCarrier,
} from "./types";
import { carrierRateCardSchema } from "./types";

const DISCLAIMER =
  "Rates are approximate estimates from one-time scraped/public tariff data. Confirm final pricing with the carrier.";

let cachedCards: { tcs: CarrierRateCard; leopards: CarrierRateCard } | null =
  null;

export function loadRateCards(): {
  tcs: CarrierRateCard;
  leopards: CarrierRateCard;
} {
  if (cachedCards) return cachedCards;

  const tcs = carrierRateCardSchema.parse(tcsRates);
  const leopards = carrierRateCardSchema.parse(leopardsRates);
  cachedCards = { tcs, leopards };
  return cachedCards;
}

export function loadRateCardsForTest(
  tcs: CarrierRateCard,
  leopards: CarrierRateCard
) {
  cachedCards = { tcs, leopards };
}

export function resetRateCardCache() {
  cachedCards = null;
}

type ScoredCarrier = {
  carrier: CourierCarrier;
  quote: CarrierQuote;
  score: number;
  eligible: boolean;
};

function scoreCarrier(
  quote: CarrierQuote,
  toZone: CompareResult["resolved"]["toZone"],
  codRequested: boolean
): ScoredCarrier {
  const eligible =
    quote.coverage === "supported" &&
    quote.totalPrice !== null &&
    (!codRequested || quote.codSupported);

  if (!eligible) {
    return { carrier: quote.carrier, quote, score: -Infinity, eligible: false };
  }

  let score = 10000 - (quote.totalPrice ?? 0);

  if (toZone === "remote" && quote.coverage === "supported") {
    score += 500;
  }

  if (codRequested && quote.codSupported) {
    score += 50;
  }

  return { carrier: quote.carrier, quote, score, eligible: true };
}

function buildReason(
  winner: ScoredCarrier | null,
  scored: ScoredCarrier[],
  toZone: CompareResult["resolved"]["toZone"],
  codRequested: boolean
): string {
  if (!winner) {
    return "Neither carrier can service this route with the given parameters.";
  }

  const loser = scored.find((s) => s.carrier !== winner.carrier);
  const parts: string[] = [];

  parts.push(
    `${winner.carrier.toUpperCase()} is recommended with an estimated total of PKR ${winner.quote.totalPrice}.`
  );

  if (loser?.eligible && loser.quote.totalPrice !== null && winner.quote.totalPrice !== null) {
    const diff = loser.quote.totalPrice - winner.quote.totalPrice;
    if (diff > 0) {
      parts.push(
        `It is PKR ${diff} cheaper than ${loser.carrier.toUpperCase()} for this route.`
      );
    }
  }

  if (toZone === "remote") {
    parts.push("Remote destination coverage was prioritized alongside price.");
  }

  if (codRequested) {
    parts.push("COD support and fees were included in the comparison.");
  }

  if (!loser?.eligible && loser) {
    parts.push(
      `${loser.carrier.toUpperCase()} is unavailable or does not support this route${codRequested && !loser.quote.codSupported ? " with COD" : ""}.`
    );
  }

  parts.push(DISCLAIMER);
  return parts.join(" ");
}

export function compareCouriers(input: {
  fromAddress: string;
  toAddress: string;
  weightKg: number;
  codAmount?: number;
}): CompareResult {
  const { tcs, leopards } = loadRateCards();
  const allCities = mergeCityLists(tcs.cities, leopards.cities);

  const fromMatch = matchCityInAddress(input.fromAddress, allCities);
  if (!fromMatch.ok) {
    throw new CityMatchError("from", fromMatch);
  }
  const toMatch = matchCityInAddress(input.toAddress, allCities);
  if (!toMatch.ok) {
    throw new CityMatchError("to", toMatch);
  }

  const from = fromMatch.city;
  const to = toMatch.city;
  const sameCity = from.name === to.name;
  const codRequested = (input.codAmount ?? 0) > 0;

  const tcsQuote = quoteCarrier({
    card: tcs,
    from,
    to,
    sameCity,
    weightKg: input.weightKg,
    codAmount: input.codAmount,
  });
  const leopardsQuote = quoteCarrier({
    card: leopards,
    from,
    to,
    sameCity,
    weightKg: input.weightKg,
    codAmount: input.codAmount,
  });

  const scored = [
    scoreCarrier(tcsQuote, to.zone, codRequested),
    scoreCarrier(leopardsQuote, to.zone, codRequested),
  ];

  const eligible = scored.filter((s) => s.eligible).sort((a, b) => b.score - a.score);
  const winner = eligible[0] ?? null;

  const dataAsOf = tcs.scrapedAt >= leopards.scrapedAt ? tcs.scrapedAt : leopards.scrapedAt;

  return {
    recommended: winner?.carrier ?? null,
    reason: buildReason(winner, scored, to.zone, codRequested),
    resolved: {
      fromCity: from.name,
      toCity: to.name,
      fromZone: from.zone,
      toZone: to.zone,
      sameCity,
    },
    quotes: {
      tcs: tcsQuote,
      leopards: leopardsQuote,
    },
    dataAsOf,
    disclaimer: DISCLAIMER,
  };
}

export { CityMatchError };
