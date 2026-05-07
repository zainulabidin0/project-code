import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { and, count, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

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

  const pid = resolved.ctx.projectId;

  const [tot] = await db
    .select({ c: count() })
    .from(reviews)
    .where(eq(reviews.projectId, pid));

  const [pos] = await db
    .select({ c: count() })
    .from(reviews)
    .where(
      and(
        eq(reviews.projectId, pid),
        eq(reviews.sentiment, "POSITIVE")
      )
    );

  const [neg] = await db
    .select({ c: count() })
    .from(reviews)
    .where(
      and(eq(reviews.projectId, pid), eq(reviews.sentiment, "NEGATIVE"))
    );

  const [netRow] = await db
    .select({ s: sql<number>`coalesce(sum(${reviews.score}), 0)::int` })
    .from(reviews)
    .where(eq(reviews.projectId, pid));

  const res = NextResponse.json({
    success: true,
    data: {
      total: tot?.c ?? 0,
      positive: pos?.c ?? 0,
      negative: neg?.c ?? 0,
      netScore: netRow?.s ?? 0,
    },
  });
  res.headers.set("X-RateLimit-Limit", String(resolved.rate.limit));
  res.headers.set("X-RateLimit-Remaining", String(resolved.rate.remaining));
  res.headers.set("X-RateLimit-Reset", String(resolved.rate.reset));
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
