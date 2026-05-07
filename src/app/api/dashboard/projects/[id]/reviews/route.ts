import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { projects, reviews } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

type Params = { params: { id: string } };

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

async function assertProject(userId: string, projectId: string) {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const p = await assertProject(access.sub, params.id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

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
    .where(eq(reviews.projectId, params.id))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reviews)
    .where(eq(reviews.projectId, params.id));

  return NextResponse.json({
    success: true,
    data: {
      reviews: rows,
      total: totalRow?.c ?? 0,
      limit,
      offset,
    },
  });
}
