import { createHash } from "crypto";
import { applyRegexLayer, normalizeForCacheKey } from "./regex";
import { correctWithGroq } from "./ai-agent";
import { redisGet, redisSet } from "@/lib/redis";
import type { CorrectionType } from "@/lib/db/schema";

export interface CorrectionOutput {
  original: string;
  corrected: string;
  confidence: number;
  correctionType: CorrectionType;
  changes: string[];
  processingMs: number;
}

const CACHE_TTL = 24 * 60 * 60;
const MAX_CACHE_INPUT = 500;

function cacheKey(normalized: string): string {
  const h = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `addr:${h}`;
}

export async function correctAddress(input: {
  address: string;
  regexOnly?: boolean;
}): Promise<CorrectionOutput> {
  const start = Date.now();
  const original = input.address;
  const normalized = normalizeForCacheKey(original);

  if (original.length <= MAX_CACHE_INPUT) {
    const cached = await redisGet(cacheKey(normalized));
    if (cached) {
      try {
        const j = JSON.parse(cached) as Omit<
          CorrectionOutput,
          "original" | "processingMs"
        >;
        return {
          original,
          corrected: j.corrected,
          confidence: j.confidence,
          correctionType: j.correctionType,
          changes: j.changes,
          processingMs: Date.now() - start,
        };
      } catch {
        /* continue */
      }
    }
  }

  const { output: regexOut } = applyRegexLayer(original);
  const structurallySame =
    normalizeForCacheKey(original) === normalizeForCacheKey(regexOut);

  if (input.regexOnly) {
    const out: CorrectionOutput = {
      original,
      corrected: regexOut,
      confidence: structurallySame ? 1 : 0.85,
      correctionType: structurallySame ? "NO_CHANGE" : "REGEX_ONLY",
      changes: structurallySame ? [] : ["Applied regex normalization"],
      processingMs: Date.now() - start,
    };
    await maybeSetCache(normalized, out);
    return out;
  }

  if (structurallySame) {
    const out: CorrectionOutput = {
      original,
      corrected: regexOut,
      confidence: 0.99,
      correctionType: "NO_CHANGE",
      changes: [],
      processingMs: Date.now() - start,
    };
    await maybeSetCache(normalized, out);
    return out;
  }

  if (!process.env.GROQ_API_KEY) {
    const out: CorrectionOutput = {
      original,
      corrected: regexOut,
      confidence: 0.75,
      correctionType: "REGEX_ONLY",
      changes: ["AI unavailable; regex only"],
      processingMs: Date.now() - start,
    };
    await maybeSetCache(normalized, out);
    return out;
  }

  try {
    const ai = await correctWithGroq(regexOut);
    const out: CorrectionOutput = {
      original,
      corrected: ai.corrected,
      confidence: ai.confidence,
      correctionType: "AI_CORRECTED",
      changes: ai.changes,
      processingMs: Date.now() - start,
    };
    await maybeSetCache(normalized, out);
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[address-correction] AI step failed; using regex fallback.",
      { message, inputLength: original.length }
    );
    if (process.env.NODE_ENV === "development" && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    const out: CorrectionOutput = {
      original,
      corrected: regexOut,
      confidence: 0.7,
      correctionType: "REGEX_ONLY",
      changes: ["AI failed; returned regex output"],
      processingMs: Date.now() - start,
    };
    await maybeSetCache(normalized, out);
    return out;
  }
}

async function maybeSetCache(
  normalized: string,
  out: CorrectionOutput
): Promise<void> {
  if (out.original.length > MAX_CACHE_INPUT) return;
  await redisSet(
    cacheKey(normalized),
    JSON.stringify({
      corrected: out.corrected,
      confidence: out.confidence,
      correctionType: out.correctionType,
      changes: out.changes,
    }),
    CACHE_TTL
  );
}
