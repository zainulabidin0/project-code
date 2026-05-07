import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken } from "@/lib/auth/jwt";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { deleteRefreshById } from "@/lib/auth/refresh-rotation";
import { getAccessPayload } from "@/lib/auth/session";
import { redisSet } from "@/lib/redis";
import { createHash } from "crypto";
import { ACCESS_TTL_SEC } from "@/lib/auth/jwt";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (cookieToken) {
    const p = verifyRefreshToken(cookieToken);
    if (p) {
      await deleteRefreshById(p.jti);
    }
  }

  const access = await getAccessPayload(req);
  if (access) {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (token) {
      const h = createHash("sha256").update(token, "utf8").digest("hex");
      await redisSet(`abl:${h}`, "1", ACCESS_TTL_SEC);
    }
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
