import { db } from "@/lib/db";
import { apiKeys, projects, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashApiKey } from "@/lib/api-key/hash";
import type { Plan } from "@/lib/db/schema";
import { rateLimitApiKey } from "@/lib/rate-limit";

export interface ApiKeyContext {
  apiKeyId: string;
  hashedKey: string;
  projectId: string;
  userId: string;
  plan: Plan;
}

export async function resolveApiKey(
  rawKey: string | null
): Promise<
  | { ok: true; ctx: ApiKeyContext; rate: { limit: number; remaining: number; reset: number } }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!rawKey || !rawKey.startsWith("af_live_")) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_API_KEY",
      message: "Invalid or missing API key.",
    };
  }
  const hashedKey = hashApiKey(rawKey);
  const rows = await db
    .select({
      id: apiKeys.id,
      hashedKey: apiKeys.hashedKey,
      projectId: apiKeys.projectId,
      isActive: apiKeys.isActive,
      expiresAt: apiKeys.expiresAt,
      userId: users.id,
      plan: users.plan,
    })
    .from(apiKeys)
    .innerJoin(projects, eq(apiKeys.projectId, projects.id))
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(apiKeys.hashedKey, hashedKey))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_API_KEY",
      message: "API key not found.",
    };
  }
  if (!row.isActive) {
    return {
      ok: false,
      status: 403,
      code: "API_KEY_REVOKED",
      message: "API key has been revoked.",
    };
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    return {
      ok: false,
      status: 403,
      code: "API_KEY_EXPIRED",
      message: "API key has expired.",
    };
  }

  const rate = await rateLimitApiKey(hashedKey, row.plan);

  if (!rate.ok) {
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests for this API key.",
    };
  }

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));

  return {
    ok: true,
    ctx: {
      apiKeyId: row.id,
      hashedKey: row.hashedKey,
      projectId: row.projectId,
      userId: row.userId,
      plan: row.plan,
    },
    rate: { limit: rate.limit, remaining: rate.remaining, reset: rate.reset },
  };
}
