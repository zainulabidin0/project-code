import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { projects, reviews } from "@/lib/db/schema";
import { and, count, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: { id: string } };

async function assertProject(userId: string, projectId: string) {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(_req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const p = await assertProject(access.sub, params.id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

  const pid = params.id;

  const [tot] = await db
    .select({ c: count() })
    .from(reviews)
    .where(eq(reviews.projectId, pid));

  const [pos] = await db
    .select({ c: count() })
    .from(reviews)
    .where(
      and(eq(reviews.projectId, pid), eq(reviews.sentiment, "POSITIVE"))
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

  const timeline = await db
    .select({
      date: sql<string>`date_trunc('day', ${reviews.createdAt})::date`,
      positive: sql<number>`count(*) filter (where ${reviews.sentiment} = 'POSITIVE')::int`,
      negative: sql<number>`count(*) filter (where ${reviews.sentiment} = 'NEGATIVE')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.projectId, pid),
        sql`${reviews.createdAt} >= now() - interval '30 days'`
      )
    )
    .groupBy(sql`date_trunc('day', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('day', ${reviews.createdAt})`);

  return NextResponse.json({
    success: true,
    data: {
      total: tot?.c ?? 0,
      positive: pos?.c ?? 0,
      negative: neg?.c ?? 0,
      netScore: netRow?.s ?? 0,
      timeline,
    },
  });
}
