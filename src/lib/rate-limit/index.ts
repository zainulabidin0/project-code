import { getRedis, redisIncrWithExpire } from "@/lib/redis";
import type { Plan } from "@/lib/db/schema";
import { PLAN_LIMITS } from "./plans";

const AUTH_WINDOW_SEC = 60;
const AUTH_MAX = 5;

/** Per-IP auth route limit (sliding window approximated via fixed window + TTL) */
export async function rateLimitAuthIp(ip: string): Promise<{
  ok: boolean;
  remaining: number;
}> {
  if (!getRedis()) return rateLimitAuthIpSync(ip);
  const key = `ratelimit:auth:ip:${ip}`;
  const n = await redisIncrWithExpire(key, AUTH_WINDOW_SEC);
  const remaining = Math.max(0, AUTH_MAX - n);
  return { ok: n <= AUTH_MAX, remaining };
}

export async function rateLimitApiKey(
  hashedKey: string,
  plan: Plan
): Promise<{ ok: boolean; limit: number; remaining: number; reset: number }> {
  if (!getRedis()) return rateLimitApiKeySync(hashedKey, plan);
  const limit = PLAN_LIMITS[plan].requestsPerMinute;
  const windowStart = Math.floor(Date.now() / 60000);
  const key = `rate:${hashedKey}:${windowStart}`;
  const n = await redisIncrWithExpire(key, 70);
  const reset = (windowStart + 1) * 60;
  const remaining = Math.max(0, limit - n);
  return { ok: n <= limit, limit, remaining, reset };
}

/** In-memory fallback when Redis unavailable */
const memAuth = new Map<string, { count: number; reset: number }>();
const memApi = new Map<string, { count: number; reset: number }>();

export function rateLimitAuthIpSync(ip: string): {
  ok: boolean;
  remaining: number;
} {
  const now = Date.now();
  let e = memAuth.get(ip);
  if (!e || now > e.reset) {
    e = { count: 0, reset: now + AUTH_WINDOW_SEC * 1000 };
    memAuth.set(ip, e);
  }
  e.count += 1;
  const remaining = Math.max(0, AUTH_MAX - e.count);
  return { ok: e.count <= AUTH_MAX, remaining };
}

export function rateLimitApiKeySync(
  hashedKey: string,
  plan: Plan
): { ok: boolean; limit: number; remaining: number; reset: number } {
  const limit = PLAN_LIMITS[plan].requestsPerMinute;
  const windowStart = Math.floor(Date.now() / 60000);
  const key = `${hashedKey}:${windowStart}`;
  const reset = (windowStart + 1) * 60;
  let e = memApi.get(key);
  if (!e || e.reset < Date.now()) {
    e = { count: 0, reset: (windowStart + 1) * 60 * 1000 };
    memApi.set(key, e);
  }
  e.count += 1;
  const remaining = Math.max(0, limit - e.count);
  return { ok: e.count <= limit, limit, remaining, reset };
}
