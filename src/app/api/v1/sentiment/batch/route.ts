import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk, countMonthlyUsage } from "@/lib/usage/quota";
import { sentimentBatchRequestSchema } from "@/lib/validations/sentiment";
import { predictSentimentBatch } from "@/lib/sentiment/client";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { getProjectNetScore } from "@/lib/sentiment/score";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

export const runtime = "nodejs";
export const maxDuration = 120;

function getRawKey(req: NextRequest): string | null {
  return req.headers.get("x-api-key")?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  const raw = getRawKey(req);
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status,
      resolved.status === 429 ? { retryAfter: 60 } : undefined
    );
  }

  const text = await req.text();
  if (text.length > 500_000) {
    return jsonError("INVALID_INPUT", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = sentimentBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    const f = parsed.error.flatten();
    if (f.fieldErrors.reviews?.some((e) => e.includes("50"))) {
      return jsonError("BATCH_TOO_LARGE", "More than 50 reviews in batch", 400);
    }
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const items = parsed.data.reviews;
  const quota = await assertQuotaOk(resolved.ctx.projectId);
  if (!quota.ok) {
    return jsonError("QUOTA_EXCEEDED", "Monthly quota exceeded for your plan.", 429);
  }

  const used = items.length;
  const monthly = await countMonthlyUsage(resolved.ctx.projectId);
  const limit = PLAN_LIMITS[quota.plan].monthlyRequests;
  if (limit < Number.MAX_SAFE_INTEGER - 1000 && monthly + used > limit) {
    return jsonError("QUOTA_EXCEEDED", "Batch would exceed monthly quota", 429);
  }

  const t0 = Date.now();
  let batch: { results: { review: string; sentiment: "POSITIVE" | "NEGATIVE"; score: number; confidence: number }[] };
  try {
    batch = await predictSentimentBatch(items.map((i) => i.review));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Model error";
    return jsonError("MODEL_UNAVAILABLE", msg, 503);
  }
  const processingMs = Date.now() - t0;

  const out: {
    id: string;
    review: string;
    sentiment: "POSITIVE" | "NEGATIVE";
    score: number;
    confidence: number;
  }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const r = batch.results[i]!;
    const metaStr =
      item.reviewerMeta !== undefined
        ? JSON.stringify(item.reviewerMeta)
        : null;
    const [row] = await db
      .insert(reviews)
      .values({
        projectId: resolved.ctx.projectId,
        reviewText: item.review,
        sentiment: r.sentiment,
        score: r.score,
        confidence: r.confidence,
        reviewerName: item.reviewerName ?? null,
        reviewerMeta: metaStr,
        processingMs: Math.max(0, Math.floor(processingMs / items.length)),
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
      })
      .returning();
    out.push({
      id: row.id,
      review: row.reviewText,
      sentiment: row.sentiment,
      score: row.score,
      confidence: row.confidence ?? r.confidence,
    });
  }

  const projectNetScore = await getProjectNetScore(resolved.ctx.projectId);

  const res = NextResponse.json({
    success: true,
    data: { results: out, projectNetScore, processingMs },
  });
  res.headers.set("X-RateLimit-Limit", String(resolved.rate.limit));
  res.headers.set("X-RateLimit-Remaining", String(resolved.rate.remaining));
  res.headers.set("X-RateLimit-Reset", String(resolved.rate.reset));
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
