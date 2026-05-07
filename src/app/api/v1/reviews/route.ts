import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

function getRawKey(req: NextRequest): string | null {
  return req.headers.get("x-api-key")?.trim() ?? null;
}

export async function GET(req: NextRequest) {
  const raw = getRawKey(req);
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status
    );
  }

  const { searchParams } = new URL(req.url);
  const q = listQuery.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });
  if (!q.success) {
    return jsonError("INVALID_INPUT", q.error.message, 400);
  }

  const { limit, offset } = q.data;
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.projectId, resolved.ctx.projectId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reviews)
    .where(eq(reviews.projectId, resolved.ctx.projectId));

  const res = NextResponse.json({
    success: true,
    data: {
      reviews: rows.map((r) => ({
        id: r.id,
        review: r.reviewText,
        sentiment: r.sentiment,
        score: r.score,
        confidence: r.confidence,
        reviewerName: r.reviewerName,
        createdAt: r.createdAt,
      })),
      total: totalRow?.c ?? 0,
      limit,
      offset,
    },
  });
  res.headers.set("X-RateLimit-Limit", String(resolved.rate.limit));
  res.headers.set("X-RateLimit-Remaining", String(resolved.rate.remaining));
  res.headers.set("X-RateLimit-Reset", String(resolved.rate.reset));
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
