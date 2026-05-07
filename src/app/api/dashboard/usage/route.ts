import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { usageLogs, projects, users } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { countMonthlyUsage } from "@/lib/usage/quota";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

export const runtime = "nodejs";

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function GET(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const userRow = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, access.sub))
    .limit(1);
  const plan = userRow[0]?.plan ?? "FREE";

  const projectIds = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, access.sub));

  const ids = projectIds.map((p) => p.id);
  if (ids.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        monthlyUsed: 0,
        monthlyLimit: PLAN_LIMITS[plan].monthlyRequests,
        recent: [],
      },
    });
  }

  let monthlyUsed = 0;
  for (const id of ids) {
    monthlyUsed += await countMonthlyUsage(id);
  }

  const start = monthStart();
  const recent = await db
    .select({
      id: usageLogs.id,
      projectId: usageLogs.projectId,
      inputAddress: usageLogs.inputAddress,
      outputAddress: usageLogs.outputAddress,
      correctionType: usageLogs.correctionType,
      processingMs: usageLogs.processingMs,
      status: usageLogs.status,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .innerJoin(projects, eq(usageLogs.projectId, projects.id))
    .where(
      and(eq(projects.userId, access.sub), gte(usageLogs.createdAt, start))
    )
    .orderBy(desc(usageLogs.createdAt))
    .limit(100);

  return NextResponse.json({
    success: true,
    data: {
      monthlyUsed,
      monthlyLimit: PLAN_LIMITS[plan].monthlyRequests,
      recent,
    },
  });
}
