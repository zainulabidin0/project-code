import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken } from "@/lib/auth/jwt";
import { signAccessToken } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/errors";
import { REFRESH_COOKIE, COOKIE_MAX_AGE_SEC } from "@/lib/auth/constants";
import { consumeAndRotateRefresh } from "@/lib/auth/refresh-rotation";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!cookieToken) {
    return jsonError("UNAUTHORIZED", "Missing refresh session", 401);
  }

  const payload = verifyRefreshToken(cookieToken);
  if (!payload) {
    return jsonError("UNAUTHORIZED", "Invalid refresh token", 401);
  }

  const rotated = await consumeAndRotateRefresh({
    cookieToken,
    jti: payload.jti,
    userId: payload.sub,
    familyId: payload.fam,
    userAgent: req.headers.get("user-agent"),
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined,
  });

  if (!rotated.ok) {
    if (rotated.reason === "reuse") {
      return jsonError("UNAUTHORIZED", "Session invalidated", 401);
    }
    return jsonError("UNAUTHORIZED", "Invalid or expired session", 401);
  }

  const row = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);
  const user = row[0];
  if (!user) {
    return jsonError("UNAUTHORIZED", "User not found", 401);
  }

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    plan: user.plan,
  });

  const res = NextResponse.json({
    success: true,
    data: { accessToken, expiresIn: 15 * 60 },
  });
  res.cookies.set(REFRESH_COOKIE, rotated.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}
