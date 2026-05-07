import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { singleSentimentRequestSchema } from "@/lib/validations/sentiment";
import { predictSentiment } from "@/lib/sentiment/client";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { getProjectNetScore } from "@/lib/sentiment/score";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  if (text.length > 50_000) {
    return jsonError("INVALID_INPUT", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = singleSentimentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const quota = await assertQuotaOk(resolved.ctx.projectId);
  if (!quota.ok) {
    return jsonError("QUOTA_EXCEEDED", "Monthly quota exceeded for your plan.", 429);
  }

  const t0 = Date.now();
  let ml: Awaited<ReturnType<typeof predictSentiment>>;
  try {
    ml = await predictSentiment(parsed.data.review);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Model error";
    return jsonError("MODEL_UNAVAILABLE", msg, 503);
  }
  const processingMs = Date.now() - t0;

  const metaStr =
    parsed.data.reviewerMeta !== undefined
      ? JSON.stringify(parsed.data.reviewerMeta)
      : null;

  const [row] = await db
    .insert(reviews)
    .values({
      projectId: resolved.ctx.projectId,
      reviewText: parsed.data.review,
      sentiment: ml.sentiment,
      score: ml.score,
      confidence: ml.confidence,
      reviewerName: parsed.data.reviewerName ?? null,
      reviewerMeta: metaStr,
      processingMs,
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
    })
    .returning();

  const projectNetScore = await getProjectNetScore(resolved.ctx.projectId);

  const res = NextResponse.json({
    success: true,
    data: {
      id: row.id,
      review: row.reviewText,
      sentiment: row.sentiment,
      score: row.score,
      confidence: row.confidence ?? ml.confidence,
      reviewerName: row.reviewerName,
      processingMs,
      projectNetScore,
    },
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
