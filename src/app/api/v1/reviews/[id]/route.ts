import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: { id: string } };

function getRawKey(req: NextRequest): string | null {
  return req.headers.get("x-api-key")?.trim() ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const raw = getRawKey(req);
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status
    );
  }

  const [row] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.id, params.id),
        eq(reviews.projectId, resolved.ctx.projectId)
      )
    )
    .limit(1);

  if (!row) {
    return jsonError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  let reviewerMeta: unknown = null;
  if (row.reviewerMeta) {
    try {
      reviewerMeta = JSON.parse(row.reviewerMeta) as unknown;
    } catch {
      reviewerMeta = null;
    }
  }

  const res = NextResponse.json({
    success: true,
    data: {
      id: row.id,
      review: row.reviewText,
      sentiment: row.sentiment,
      score: row.score,
      confidence: row.confidence,
      reviewerName: row.reviewerName,
      reviewerMeta,
      createdAt: row.createdAt,
    },
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const raw = getRawKey(req);
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status
    );
  }

  const del = await db
    .delete(reviews)
    .where(
      and(
        eq(reviews.id, params.id),
        eq(reviews.projectId, resolved.ctx.projectId)
      )
    )
    .returning({ id: reviews.id });

  if (!del[0]) {
    return jsonError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  const res = NextResponse.json({ success: true });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
