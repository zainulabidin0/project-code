import type { NextRequest } from "next/server";
import { verifyAccessToken } from "./jwt";
import type { AccessTokenPayload } from "@/types";
import { redisGet } from "@/lib/redis";
import { createHash } from "crypto";

export async function getAccessPayload(
  req: NextRequest
): Promise<AccessTokenPayload | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  const h = createHash("sha256").update(token, "utf8").digest("hex");
  const bl = await redisGet(`abl:${h}`);
  if (bl) return null;
  return payload;
}
