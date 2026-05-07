import { db } from "@/lib/db";
import { usageLogs, projects, users, reviews, shopUsageLogs } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Plan } from "@/lib/db/schema";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function countMonthlyUsage(projectId: string): Promise<number> {
  const start = monthStart();
  const [u, r, s] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.projectId, projectId),
          gte(usageLogs.createdAt, start),
          eq(usageLogs.status, "SUCCESS")
        )
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(reviews)
      .where(
        and(
          eq(reviews.projectId, projectId),
          gte(reviews.createdAt, start)
        )
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(shopUsageLogs)
      .where(
        and(
          eq(shopUsageLogs.projectId, projectId),
          gte(shopUsageLogs.createdAt, start),
          eq(shopUsageLogs.status, "SUCCESS")
        )
      ),
  ]);
  return (u[0]?.c ?? 0) + (r[0]?.c ?? 0) + (s[0]?.c ?? 0);
}

export async function getUserPlanForProject(
  projectId: string
): Promise<Plan | null> {
  const row = await db
    .select({ plan: users.plan })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row[0]?.plan ?? null;
}

export async function assertQuotaOk(
  projectId: string
): Promise<{ ok: true; plan: Plan } | { ok: false; plan: Plan; limit: number }> {
  const plan = await getUserPlanForProject(projectId);
  if (!plan) return { ok: false, plan: "FREE", limit: 0 };
  const limit = PLAN_LIMITS[plan].monthlyRequests;
  if (limit >= Number.MAX_SAFE_INTEGER - 1000) {
    return { ok: true, plan };
  }
  const used = await countMonthlyUsage(projectId);
  if (used >= limit) {
    return { ok: false, plan, limit };
  }
  return { ok: true, plan };
}
