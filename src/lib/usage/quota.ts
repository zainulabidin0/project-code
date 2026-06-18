import { db } from "@/lib/db";
import { usageLogs, projects, users, reviews, shopUsageLogs } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Plan } from "@/lib/db/schema";
import {
  getShopActionLimit,
  isUnlimitedLimit,
  type ShopUsageAction,
} from "@/lib/rate-limit/plans";
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

export async function countMonthlyShopAction(
  projectId: string,
  actionType: ShopUsageAction
): Promise<number> {
  const start = monthStart();
  const row = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(shopUsageLogs)
    .where(
      and(
        eq(shopUsageLogs.projectId, projectId),
        eq(shopUsageLogs.actionType, actionType),
        gte(shopUsageLogs.createdAt, start),
        eq(shopUsageLogs.status, "SUCCESS")
      )
    );
  return row[0]?.c ?? 0;
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

export type ShopActionQuotaStatus = {
  actionType: ShopUsageAction;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
};

export async function getShopActionQuotaStatus(
  projectId: string,
  actionType: ShopUsageAction
): Promise<ShopActionQuotaStatus & { plan: Plan }> {
  const plan = (await getUserPlanForProject(projectId)) ?? "FREE";
  const limit = getShopActionLimit(plan, actionType);
  const unlimited = isUnlimitedLimit(limit);
  const used = unlimited ? 0 : await countMonthlyShopAction(projectId, actionType);
  const remaining = unlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, actionType, used, limit, remaining, unlimited };
}

export async function assertQuotaOk(
  projectId: string
): Promise<{ ok: true; plan: Plan } | { ok: false; plan: Plan; limit: number }> {
  const plan = await getUserPlanForProject(projectId);
  if (!plan) return { ok: false, plan: "FREE", limit: 0 };
  const limit = PLAN_LIMITS[plan].monthlyRequests;
  if (isUnlimitedLimit(limit)) {
    return { ok: true, plan };
  }
  const used = await countMonthlyUsage(projectId);
  if (used >= limit) {
    return { ok: false, plan, limit };
  }
  return { ok: true, plan };
}

export async function assertShopActionQuotaOk(
  projectId: string,
  actionType: ShopUsageAction
): Promise<
  | { ok: true; plan: Plan; used: number; limit: number }
  | { ok: false; plan: Plan; used: number; limit: number; actionType: ShopUsageAction }
> {
  const plan = await getUserPlanForProject(projectId);
  if (!plan) {
    return { ok: false, plan: "FREE", used: 0, limit: 0, actionType };
  }

  const limit = getShopActionLimit(plan, actionType);
  if (isUnlimitedLimit(limit)) {
    return { ok: true, plan, used: 0, limit };
  }

  const used = await countMonthlyShopAction(projectId, actionType);
  if (used >= limit) {
    return { ok: false, plan, used, limit, actionType };
  }

  return { ok: true, plan, used, limit };
}
