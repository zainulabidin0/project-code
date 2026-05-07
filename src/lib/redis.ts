import Redis from "ioredis";

let client: Redis | null = null;

/** Template URLs from .env.example use hostname `host`, which always fails DNS. */
function isUnusableRedisUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === "" || h === "host";
  } catch {
    return true;
  }
}

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url || isUnusableRedisUrl(url)) return null;
  if (!client) {
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 4000,
      retryStrategy(times) {
        if (times > 4) return null;
        return Math.min(times * 300, 2000);
      },
    });
    // ioredis emits "error" on connection failures; without a listener Node logs "Unhandled error event"
    client.on("error", () => {});
  }
  return client;
}

export async function redisGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.setex(key, ttlSeconds, value);
  } catch {
    /* ignore */
  }
}

export async function redisIncrWithExpire(
  key: string,
  ttlSeconds: number
): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, ttlSeconds);
    return n;
  } catch {
    return 0;
  }
}

export async function redisSaddWithExpire(
  key: string,
  member: string,
  ttlSeconds: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.sadd(key, member);
    await r.expire(key, ttlSeconds);
  } catch {
    /* ignore */
  }
}

export async function redisSismember(
  key: string,
  member: string
): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    return (await r.sismember(key, member)) === 1;
  } catch {
    return false;
  }
}
