import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { projects, reviewPageSettings, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { createProjectSchema } from "@/lib/validations/project";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      reviewTotal: sql<number>`(
        select count(*)::int from reviews
        where reviews.project_id = ${projects.id}
      )`,
      reviewPositive: sql<number>`(
        select count(*)::int from reviews
        where reviews.project_id = ${projects.id}
          and reviews.sentiment = 'POSITIVE'
      )`,
      reviewNegative: sql<number>`(
        select count(*)::int from reviews
        where reviews.project_id = ${projects.id}
          and reviews.sentiment = 'NEGATIVE'
      )`,
      reviewNetScore: sql<number>`(
        select coalesce(sum(score), 0)::int from reviews
        where reviews.project_id = ${projects.id}
      )`,
    })
    .from(projects)
    .where(eq(projects.userId, access.sub));

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const u = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, access.sub))
    .limit(1);
  const plan = u[0]?.plan ?? "FREE";
  const maxP = PLAN_LIMITS[plan].maxProjects;

  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.userId, access.sub));
  if (c >= maxP) {
    return jsonError(
      "INVALID_INPUT",
      "Project limit reached for your plan.",
      400
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const [row] = await db
    .insert(projects)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      userId: access.sub,
    })
    .returning();

  await db.insert(reviewPageSettings).values({
    projectId: row.id,
    isPublic: false,
    showScores: true,
  });

  return NextResponse.json({ success: true, data: row });
}
