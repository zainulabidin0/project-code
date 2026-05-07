import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { refreshTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { signRefreshToken, REFRESH_TTL_SEC } from "./jwt";
import { redisGet, redisSet } from "@/lib/redis";

const REVOKE_PREFIX = "af_rev_jti:";

export async function markJtiRevoked(jti: string, familyId: string): Promise<void> {
  await redisSet(`${REVOKE_PREFIX}${jti}`, familyId, REFRESH_TTL_SEC);
}

export async function isJtiRevoked(jti: string): Promise<boolean> {
  const v = await redisGet(`${REVOKE_PREFIX}${jti}`);
  return v !== null && v !== "";
}

export function newRefreshSession(input: {
  userId: string;
  familyId?: string;
  userAgent?: string | null;
  ip?: string | null;
}): { token: string; id: string; familyId: string; expiresAt: Date } {
  const id = createId();
  const familyId = input.familyId ?? createId();
  const token = signRefreshToken({
    userId: input.userId,
    jti: id,
    familyId,
  });
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  return { token, id, familyId, expiresAt };
}

export async function persistRefreshToken(row: {
  id: string;
  token: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<void> {
  await db.insert(refreshTokens).values({
    id: row.id,
    token: row.token,
    userId: row.userId,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    userAgent: row.userAgent ?? null,
    ip: row.ip ?? null,
  });
}

export async function findRefreshByToken(cookieToken: string) {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token, cookieToken))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteRefreshById(id: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.id, id));
}

export async function revokeAllRefreshForUser(userId: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}

export async function consumeAndRotateRefresh(input: {
  cookieToken: string;
  jti: string;
  userId: string;
  familyId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<
  | { ok: true; refreshToken: string; expiresAt: Date }
  | { ok: false; reason: "not_found" | "reuse" }
> {
  const row = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.id, input.jti),
        eq(refreshTokens.token, input.cookieToken),
        eq(refreshTokens.userId, input.userId)
      )
    )
    .limit(1);

  if (!row[0]) {
    const reused = await isJtiRevoked(input.jti);
    if (reused) {
      await revokeAllRefreshForUser(input.userId);
      return { ok: false, reason: "reuse" };
    }
    return { ok: false, reason: "not_found" };
  }

  await markJtiRevoked(input.jti, input.familyId);
  await deleteRefreshById(input.jti);

  const next = newRefreshSession({
    userId: input.userId,
    familyId: input.familyId,
    userAgent: input.userAgent,
    ip: input.ip,
  });
  await persistRefreshToken({
    id: next.id,
    token: next.token,
    userId: input.userId,
    familyId: next.familyId,
    expiresAt: next.expiresAt,
    userAgent: input.userAgent,
    ip: input.ip,
  });

  return { ok: true, refreshToken: next.token, expiresAt: next.expiresAt };
}
