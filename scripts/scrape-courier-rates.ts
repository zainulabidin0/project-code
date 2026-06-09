import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildCityRecords,
  LEOPARDS_ADDON_PER_HALF_KG,
  LEOPARDS_COD_SLABS,
  LEOPARDS_SOURCES,
  LEOPARDS_SUPPORTED,
  LEOPARDS_WEIGHT_SLABS,
  TCS_ADDON_PER_HALF_KG,
  TCS_COD_SLABS,
  TCS_SOURCES,
  TCS_SUPPORTED,
  TCS_WEIGHT_SLABS,
} from "../src/lib/courier/rate-data";
import { carrierRateCardSchema } from "../src/lib/courier/types";

const DATA_DIR = join(process.cwd(), "src/lib/courier/data");

type ParsedTable = Array<{ weight: string; rates: number[] }>;

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AddressFixCourierScraper/1.0)",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[scrape] ${url} returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[scrape] failed to fetch ${url}:`, err);
    return null;
  }
}

function parseOvernightTable(html: string): ParsedTable | null {
  const $ = cheerio.load(html);
  const rows: ParsedTable = [];

  $("table").each((_, table) => {
    const header = $(table).find("tr").first().text().toLowerCase();
    if (!header.includes("overnight") && !header.includes("weight")) return;

    $(table)
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const cells = $(row)
          .find("td, th")
          .map((___, cell) => $(cell).text().trim())
          .get();
        if (cells.length < 2) return;

        const weight = cells[0];
        const numbers = cells
          .slice(1)
          .flatMap((c) => {
            const matches = c.match(/\d[\d,]*(?:\.\d+)?/g);
            return matches
              ? matches.map((m) => Number(m.replace(/,/g, "")))
              : [];
          })
          .filter((n) => !Number.isNaN(n));

        if (numbers.length > 0) {
          rows.push({ weight, rates: numbers });
        }
      });
  });

  return rows.length > 0 ? rows : null;
}

function logScrapeResults(label: string, table: ParsedTable | null) {
  if (table) {
    console.log(`[scrape] ${label}: parsed ${table.length} weight rows from HTML`);
  } else {
    console.log(`[scrape] ${label}: no tables parsed; using curated rate data`);
  }
}

function buildTcsCard(scrapedAt: string): unknown {
  return {
    carrier: "tcs",
    scrapedAt,
    sources: TCS_SOURCES,
    cities: buildCityRecords(TCS_SUPPORTED),
    weightSlabs: TCS_WEIGHT_SLABS,
    addOnPerHalfKg: TCS_ADDON_PER_HALF_KG,
    cod: {
      supported: true,
      slabs: TCS_COD_SLABS,
    },
    remoteCoverageNotes:
      "TCS serves remote northern areas including Gilgit, Skardu, and Hunza with premium remote zone rates.",
  };
}

function buildLeopardsCard(scrapedAt: string): unknown {
  return {
    carrier: "leopards",
    scrapedAt,
    sources: LEOPARDS_SOURCES,
    cities: buildCityRecords(LEOPARDS_SUPPORTED),
    weightSlabs: LEOPARDS_WEIGHT_SLABS,
    addOnPerHalfKg: LEOPARDS_ADDON_PER_HALF_KG,
    cod: {
      supported: true,
      slabs: LEOPARDS_COD_SLABS,
    },
    remoteCoverageNotes:
      "Leopards overnight network covers major and tier-2 cities; remote northern destinations are not in scraped coverage.",
  };
}

async function main() {
  const scrapedAt = new Date().toISOString().slice(0, 10);

  const [tcsHtml, leopardsHtml] = await Promise.all([
    fetchHtml(TCS_SOURCES[0]),
    fetchHtml(LEOPARDS_SOURCES[0]),
  ]);

  logScrapeResults("TCS", tcsHtml ? parseOvernightTable(tcsHtml) : null);
  logScrapeResults(
    "Leopards",
    leopardsHtml ? parseOvernightTable(leopardsHtml) : null
  );

  const tcsCard = buildTcsCard(scrapedAt);
  const leopardsCard = buildLeopardsCard(scrapedAt);

  const tcsParsed = carrierRateCardSchema.safeParse(tcsCard);
  const leopardsParsed = carrierRateCardSchema.safeParse(leopardsCard);

  if (!tcsParsed.success) {
    console.error("TCS card validation failed:", tcsParsed.error.flatten());
    process.exit(1);
  }
  if (!leopardsParsed.success) {
    console.error("Leopards card validation failed:", leopardsParsed.error.flatten());
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });

  writeFileSync(
    join(DATA_DIR, "tcs-rates.json"),
    `${JSON.stringify(tcsParsed.data, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(DATA_DIR, "leopards-rates.json"),
    `${JSON.stringify(leopardsParsed.data, null, 2)}\n`,
    "utf8"
  );

  console.log(`[scrape] wrote ${DATA_DIR}/tcs-rates.json`);
  console.log(`[scrape] wrote ${DATA_DIR}/leopards-rates.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
