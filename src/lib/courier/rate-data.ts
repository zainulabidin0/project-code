import type { CityRecord } from "./types";
import { PAKISTAN_CITIES } from "./pakistan-cities";

export { PAKISTAN_CITIES };

export function buildCityRecords(
  supportedNames: Set<string>,
  codUnsupported?: Set<string>
): CityRecord[] {
  return PAKISTAN_CITIES.filter((c) => supportedNames.has(c.name)).map((c) => ({
    name: c.name,
    aliases: c.aliases,
    zone: c.zone,
    codSupported: !(codUnsupported?.has(c.name) ?? false),
  }));
}

/** TCS overnight rates (PKR midpoints) from published 2026 charge tables. */
export const TCS_WEIGHT_SLABS = [
  {
    maxKg: 0.5,
    zoneRates: {
      within_city: 190,
      metro_to_metro: 248,
      metro_to_tier2: 275,
      metro_to_remote: 450,
      tier2_to_metro: 275,
      tier2_to_tier2: 300,
      tier2_to_remote: 480,
      remote_to_metro: 450,
      remote_to_tier2: 480,
      remote_to_remote: 520,
    },
  },
  {
    maxKg: 1,
    zoneRates: {
      within_city: 220,
      metro_to_metro: 288,
      metro_to_tier2: 315,
      metro_to_remote: 550,
      tier2_to_metro: 315,
      tier2_to_tier2: 340,
      tier2_to_remote: 580,
      remote_to_metro: 550,
      remote_to_tier2: 580,
      remote_to_remote: 620,
    },
  },
  {
    maxKg: 2,
    zoneRates: {
      within_city: 300,
      metro_to_metro: 366,
      metro_to_tier2: 400,
      metro_to_remote: 750,
      tier2_to_metro: 400,
      tier2_to_tier2: 430,
      tier2_to_remote: 780,
      remote_to_metro: 750,
      remote_to_tier2: 780,
      remote_to_remote: 820,
    },
  },
  {
    maxKg: 5,
    zoneRates: {
      within_city: 405,
      metro_to_metro: 575,
      metro_to_tier2: 620,
      metro_to_remote: 1350,
      tier2_to_metro: 620,
      tier2_to_tier2: 660,
      tier2_to_remote: 1400,
      remote_to_metro: 1350,
      remote_to_tier2: 1400,
      remote_to_remote: 1500,
    },
  },
  {
    maxKg: 10,
    zoneRates: {
      within_city: 925,
      metro_to_metro: 1045,
      metro_to_tier2: 1100,
      metro_to_remote: 2100,
      tier2_to_metro: 1100,
      tier2_to_tier2: 1150,
      tier2_to_remote: 2150,
      remote_to_metro: 2100,
      remote_to_tier2: 2150,
      remote_to_remote: 2250,
    },
  },
];

export const TCS_ADDON_PER_HALF_KG: Record<string, number> = {
  within_city: 40,
  metro_to_metro: 55,
  metro_to_tier2: 60,
  metro_to_remote: 90,
  tier2_to_metro: 60,
  tier2_to_tier2: 65,
  tier2_to_remote: 95,
  remote_to_metro: 90,
  remote_to_tier2: 95,
  remote_to_remote: 100,
};

/** Leopards express overnight rates (PKR) from published same/other province tables. */
export const LEOPARDS_WEIGHT_SLABS = [
  {
    maxKg: 0.5,
    zoneRates: {
      within_city: 120,
      metro_to_metro: 155,
      metro_to_tier2: 170,
      metro_to_tier2_same: 140,
      tier2_to_tier2: 170,
      tier2_to_metro: 170,
    },
  },
  {
    maxKg: 1,
    zoneRates: {
      within_city: 140,
      metro_to_metro: 170,
      metro_to_tier2: 190,
      metro_to_tier2_same: 140,
      tier2_to_tier2: 190,
      tier2_to_metro: 190,
    },
  },
  {
    maxKg: 2,
    zoneRates: {
      within_city: 220,
      metro_to_metro: 330,
      metro_to_tier2: 350,
      metro_to_tier2_same: 260,
      tier2_to_tier2: 350,
      tier2_to_metro: 350,
    },
  },
  {
    maxKg: 5,
    zoneRates: {
      within_city: 480,
      metro_to_metro: 710,
      metro_to_tier2: 750,
      metro_to_tier2_same: 540,
      tier2_to_tier2: 750,
      tier2_to_metro: 750,
    },
  },
  {
    maxKg: 10,
    zoneRates: {
      within_city: 900,
      metro_to_metro: 1260,
      metro_to_tier2: 1300,
      metro_to_tier2_same: 760,
      tier2_to_tier2: 1300,
      tier2_to_metro: 1300,
    },
  },
];

export const LEOPARDS_ADDON_PER_HALF_KG: Record<string, number> = {
  within_city: 70,
  metro_to_metro: 90,
  metro_to_tier2: 90,
  metro_to_tier2_same: 80,
  tier2_to_tier2: 90,
  tier2_to_metro: 90,
};

export const TCS_COD_SLABS = [
  { maxAmount: 5000, fee: 75 },
  { maxAmount: 10000, fee: 125 },
  { maxAmount: 20000, fee: 200 },
  { maxAmount: 50000, fee: 325 },
];

export const LEOPARDS_COD_SLABS = [
  { maxAmount: 5000, fee: 60 },
  { maxAmount: 10000, fee: 100 },
  { maxAmount: 20000, fee: 175 },
  { maxAmount: 50000, fee: 300 },
];

export const TCS_SOURCES = [
  "https://tcsexpress.com.pk/tcs-courier-charges/",
  "https://tcsexpress.com.pk/tcs-rate-calculator/",
];

export const LEOPARDS_SOURCES = [
  "https://ecom.leopardscourier.com/business/express-overnight",
  "http://ecomuae.leopardscourier.com/pages/content/yellow-box.html",
];

/** Leopards does not serve these remote / low-coverage destinations in scraped data. */
export const LEOPARDS_UNSUPPORTED_CITIES = new Set([
  "Gilgit",
  "Skardu",
  "Hunza",
  "Chitral",
  "Gwadar",
  "Murree",
  "Astore",
  "Ghizer",
  "Ghanche",
  "Nagar",
  "Parachinar",
]);

export const TCS_SUPPORTED = new Set(PAKISTAN_CITIES.map((c) => c.name));

export const LEOPARDS_SUPPORTED = new Set(
  PAKISTAN_CITIES.filter((c) => !LEOPARDS_UNSUPPORTED_CITIES.has(c.name)).map(
    (c) => c.name
  )
);
