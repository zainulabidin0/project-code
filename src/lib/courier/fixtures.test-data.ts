import type { CarrierRateCard } from "./types";

export const fixtureTcsCard: CarrierRateCard = {
  carrier: "tcs",
  scrapedAt: "2026-01-01",
  sources: ["test"],
  cities: [
    { name: "Karachi", aliases: ["khi"], zone: "metro", codSupported: true },
    { name: "Lahore", aliases: ["lhe"], zone: "metro", codSupported: true },
    { name: "Skardu", aliases: [], zone: "remote", codSupported: true },
  ],
  weightSlabs: [
    {
      maxKg: 1,
      zoneRates: {
        within_city: 200,
        metro_to_metro: 280,
        metro_to_remote: 550,
        remote_to_metro: 550,
      },
    },
    {
      maxKg: 5,
      zoneRates: {
        within_city: 400,
        metro_to_metro: 550,
        metro_to_remote: 1200,
        remote_to_metro: 1200,
      },
    },
  ],
  cod: {
    supported: true,
    slabs: [
      { maxAmount: 5000, fee: 75 },
      { maxAmount: 50000, fee: 200 },
    ],
  },
};

export const fixtureLeopardsCard: CarrierRateCard = {
  carrier: "leopards",
  scrapedAt: "2026-01-01",
  sources: ["test"],
  cities: [
    { name: "Karachi", aliases: ["khi"], zone: "metro", codSupported: true },
    { name: "Lahore", aliases: ["lhe"], zone: "metro", codSupported: true },
  ],
  weightSlabs: [
    {
      maxKg: 1,
      zoneRates: {
        within_city: 140,
        metro_to_metro: 170,
      },
    },
    {
      maxKg: 5,
      zoneRates: {
        within_city: 480,
        metro_to_metro: 710,
      },
    },
  ],
  cod: {
    supported: true,
    slabs: [
      { maxAmount: 5000, fee: 60 },
      { maxAmount: 50000, fee: 150 },
    ],
  },
};
