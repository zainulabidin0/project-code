import { z } from "zod";

export type CourierCarrier = "tcs" | "leopards";

export type CityZone = "metro" | "tier2" | "remote";

export type CityRecord = {
  name: string;
  aliases: string[];
  zone: CityZone;
  codSupported: boolean;
};

export type WeightSlab = {
  maxKg: number;
  zoneRates: Record<string, number>;
};

export type CodConfig = {
  supported: boolean;
  slabs?: Array<{ maxAmount: number; fee: number }>;
  feePercent?: number;
  minFee?: number;
};

export type CarrierRateCard = {
  carrier: CourierCarrier;
  scrapedAt: string;
  sources: string[];
  cities: CityRecord[];
  weightSlabs: WeightSlab[];
  addOnPerHalfKg?: Partial<Record<string, number>>;
  cod: CodConfig;
  remoteCoverageNotes?: string;
};

export type CoverageStatus = "supported" | "unsupported";

export type CarrierQuote = {
  carrier: CourierCarrier;
  basePrice: number | null;
  codFee: number | null;
  totalPrice: number | null;
  coverage: CoverageStatus;
  codSupported: boolean;
  zonePair: string | null;
  weightSlabKg: number | null;
};

export type CompareResult = {
  recommended: CourierCarrier | null;
  reason: string;
  resolved: {
    fromCity: string;
    toCity: string;
    fromZone: CityZone;
    toZone: CityZone;
    sameCity: boolean;
  };
  quotes: Record<CourierCarrier, CarrierQuote>;
  dataAsOf: string;
  disclaimer: string;
};

const cityRecordSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  zone: z.enum(["metro", "tier2", "remote"]),
  codSupported: z.boolean(),
});

const weightSlabSchema = z.object({
  maxKg: z.number().positive(),
  zoneRates: z.record(z.string(), z.number().nonnegative()),
});

const codConfigSchema = z.object({
  supported: z.boolean(),
  slabs: z
    .array(
      z.object({
        maxAmount: z.number().nonnegative(),
        fee: z.number().nonnegative(),
      })
    )
    .optional(),
  feePercent: z.number().nonnegative().optional(),
  minFee: z.number().nonnegative().optional(),
});

export const carrierRateCardSchema = z.object({
  carrier: z.enum(["tcs", "leopards"]),
  scrapedAt: z.string(),
  sources: z.array(z.string()),
  cities: z.array(cityRecordSchema).min(1),
  weightSlabs: z.array(weightSlabSchema).min(1),
  addOnPerHalfKg: z.record(z.string(), z.number().nonnegative()).optional(),
  cod: codConfigSchema,
  remoteCoverageNotes: z.string().optional(),
});

export function zonePairKey(fromZone: CityZone, toZone: CityZone): string {
  return `${fromZone}_to_${toZone}`;
}

export function resolveRouteKey(
  fromZone: CityZone,
  toZone: CityZone,
  sameCity: boolean
): string {
  if (sameCity) return "within_city";
  return zonePairKey(fromZone, toZone);
}
