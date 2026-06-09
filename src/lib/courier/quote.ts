import type {
  CarrierQuote,
  CarrierRateCard,
  CityRecord,
  CodConfig,
} from "./types";
import { resolveRouteKey } from "./types";

function pickWeightSlab(weightKg: number, card: CarrierRateCard) {
  const sorted = [...card.weightSlabs].sort((a, b) => a.maxKg - b.maxKg);
  return sorted.find((s) => weightKg <= s.maxKg) ?? sorted[sorted.length - 1];
}

function calcBasePrice(
  weightKg: number,
  routeKey: string,
  card: CarrierRateCard
): { basePrice: number; slabKg: number } | null {
  const slab = pickWeightSlab(weightKg, card);
  const baseRate = slab.zoneRates[routeKey];
  if (baseRate === undefined) return null;

  if (weightKg <= slab.maxKg) {
    return { basePrice: baseRate, slabKg: slab.maxKg };
  }

  const addOn = card.addOnPerHalfKg?.[routeKey];
  if (!addOn) return { basePrice: baseRate, slabKg: slab.maxKg };

  const extraKg = weightKg - slab.maxKg;
  const halfKgUnits = Math.ceil(extraKg / 0.5);
  return {
    basePrice: baseRate + halfKgUnits * addOn,
    slabKg: slab.maxKg,
  };
}

function calcCodFee(cod: CodConfig, codAmount: number | undefined): number | null {
  if (codAmount === undefined || codAmount <= 0) return 0;
  if (!cod.supported) return null;

  if (cod.slabs?.length) {
    const sorted = [...cod.slabs].sort((a, b) => a.maxAmount - b.maxAmount);
    const slab = sorted.find((s) => codAmount <= s.maxAmount) ?? sorted[sorted.length - 1];
    return slab.fee;
  }

  if (cod.feePercent !== undefined) {
    const pct = (codAmount * cod.feePercent) / 100;
    return Math.max(pct, cod.minFee ?? 0);
  }

  return cod.minFee ?? 0;
}

export function quoteCarrier(input: {
  card: CarrierRateCard;
  from: CityRecord;
  to: CityRecord;
  sameCity: boolean;
  weightKg: number;
  codAmount?: number;
}): CarrierQuote {
  const { card, from, to, sameCity, weightKg, codAmount } = input;
  const routeKey = resolveRouteKey(from.zone, to.zone, sameCity);
  const fromInList = card.cities.some((c) => c.name === from.name);
  const toInList = card.cities.some((c) => c.name === to.name);

  if (!fromInList || !toInList) {
    return {
      carrier: card.carrier,
      basePrice: null,
      codFee: null,
      totalPrice: null,
      coverage: "unsupported",
      codSupported: card.cod.supported,
      zonePair: routeKey,
      weightSlabKg: null,
    };
  }

  const pricing = calcBasePrice(weightKg, routeKey, card);
  if (!pricing) {
    return {
      carrier: card.carrier,
      basePrice: null,
      codFee: null,
      totalPrice: null,
      coverage: "unsupported",
      codSupported: card.cod.supported,
      zonePair: routeKey,
      weightSlabKg: null,
    };
  }

  const destCity = card.cities.find((c) => c.name === to.name);
  const codSupported = card.cod.supported && (destCity?.codSupported ?? true);

  if (codAmount !== undefined && codAmount > 0 && !codSupported) {
    return {
      carrier: card.carrier,
      basePrice: pricing.basePrice,
      codFee: null,
      totalPrice: null,
      coverage: "supported",
      codSupported: false,
      zonePair: routeKey,
      weightSlabKg: pricing.slabKg,
    };
  }

  const codFee = calcCodFee(card.cod, codAmount);
  if (codAmount !== undefined && codAmount > 0 && codFee === null) {
    return {
      carrier: card.carrier,
      basePrice: pricing.basePrice,
      codFee: null,
      totalPrice: null,
      coverage: "supported",
      codSupported: false,
      zonePair: routeKey,
      weightSlabKg: pricing.slabKg,
    };
  }

  const totalCod = codFee ?? 0;
  return {
    carrier: card.carrier,
    basePrice: pricing.basePrice,
    codFee: codAmount !== undefined && codAmount > 0 ? totalCod : 0,
    totalPrice: pricing.basePrice + totalCod,
    coverage: "supported",
    codSupported,
    zonePair: routeKey,
    weightSlabKg: pricing.slabKg,
  };
}
