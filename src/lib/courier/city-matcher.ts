import type { CityRecord, CityZone } from "./types";

export type CityMatchResult =
  | {
      ok: true;
      city: CityRecord;
      confidence: "exact" | "alias" | "fuzzy";
    }
  | {
      ok: false;
      reason: "unresolved" | "ambiguous";
      suggestedCities: string[];
    };

function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

type AliasEntry = { city: CityRecord; alias: string };

function buildAliasIndex(cities: CityRecord[]): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const city of cities) {
    entries.push({ city, alias: city.name.toLowerCase() });
    for (const alias of city.aliases) {
      entries.push({ city, alias: alias.toLowerCase() });
    }
  }
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

export function matchCityInAddress(
  address: string,
  cities: CityRecord[]
): CityMatchResult {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return { ok: false, reason: "unresolved", suggestedCities: [] };
  }

  const aliases = buildAliasIndex(cities);
  const matches = new Map<string, "exact" | "alias">();

  for (const { city, alias } of aliases) {
    const pattern = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(normalized)) {
      const kind = alias === city.name.toLowerCase() ? "exact" : "alias";
      const prev = matches.get(city.name);
      if (!prev || (kind === "exact" && prev !== "exact")) {
        matches.set(city.name, kind);
      }
    }
  }

  if (matches.size > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      suggestedCities: Array.from(matches.keys()),
    };
  }

  if (matches.size === 1) {
    const [name, confidence] = Array.from(matches.entries())[0];
    const city = cities.find((c) => c.name === name)!;
    return { ok: true, city, confidence };
  }

  let best: { city: CityRecord; distance: number } | null = null;
  for (const city of cities) {
    const candidates = [city.name.toLowerCase(), ...city.aliases.map((a) => a.toLowerCase())];
    for (const candidate of candidates) {
      const distance = levenshtein(normalized.slice(-candidate.length - 5), candidate);
      if (distance <= 2 && (!best || distance < best.distance)) {
        best = { city, distance };
      }
      if (normalized.includes(candidate) || candidate.includes(normalized)) {
        const d = levenshtein(candidate, normalized.split(" ").pop() ?? normalized);
        if (d <= 2 && (!best || d < best.distance)) {
          best = { city, distance: d };
        }
      }
    }
  }

  if (best) {
    return { ok: true, city: best.city, confidence: "fuzzy" };
  }

  return {
    ok: false,
    reason: "unresolved",
    suggestedCities: cities.slice(0, 5).map((c) => c.name),
  };
}

export function resolveCityPair(
  fromAddress: string,
  toAddress: string,
  cities: CityRecord[]
): {
  from: CityRecord;
  to: CityRecord;
  sameCity: boolean;
} {
  const fromMatch = matchCityInAddress(fromAddress, cities);
  const toMatch = matchCityInAddress(toAddress, cities);

  if (!fromMatch.ok) {
    throw new CityMatchError("from", fromMatch);
  }
  if (!toMatch.ok) {
    throw new CityMatchError("to", toMatch);
  }

  return {
    from: fromMatch.city,
    to: toMatch.city,
    sameCity: fromMatch.city.name === toMatch.city.name,
  };
}

export class CityMatchError extends Error {
  constructor(
    public field: "from" | "to",
    public result: Extract<CityMatchResult, { ok: false }>
  ) {
    super(`Could not resolve ${field} city`);
    this.name = "CityMatchError";
  }
}

export function mergeCityLists(
  tcsCities: CityRecord[],
  leopardsCities: CityRecord[]
): CityRecord[] {
  const byName = new Map<string, CityRecord>();
  for (const city of [...tcsCities, ...leopardsCities]) {
    const existing = byName.get(city.name);
    if (!existing) {
      byName.set(city.name, { ...city });
      continue;
    }
    byName.set(city.name, {
      ...existing,
      aliases: Array.from(new Set([...existing.aliases, ...city.aliases])),
      codSupported: existing.codSupported || city.codSupported,
    });
  }
  return Array.from(byName.values());
}

export type { CityZone };
