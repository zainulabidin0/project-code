import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { loginSchema } from "@/lib/validations/auth";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken } from "@/lib/auth/jwt";
import { jsonError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import {
  newRefreshSession,
  persistRefreshToken,
} from "@/lib/auth/refresh-rotation";
import { REFRESH_COOKIE, COOKIE_MAX_AGE_SEC } from "@/lib/auth/constants";
import { rateLimitAuthIp } from "@/lib/rate-limit";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitAuthIp(ip);
  if (!rl.ok) {
    return jsonError(
      "RATE_LIMIT_EXCEEDED",
      "Too many login attempts.",
      429,
      { retryAfter: 60 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON body", 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", "Invalid credentials", 400);
  }

  const { email, password } = parsed.data;
  const row = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const user = row[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return jsonError("INVALID_INPUT", "Invalid email or password", 401);
  }

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    plan: user.plan,
  });

  const sess = newRefreshSession({
    userId: user.id,
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await persistRefreshToken({
    id: sess.id,
    token: sess.token,
    userId: user.id,
    familyId: sess.familyId,
    expiresAt: sess.expiresAt,
    userAgent: req.headers.get("user-agent"),
    ip,
  });

  const res = NextResponse.json({
    success: true,
    data: {
      accessToken,
      expiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
      },
    },
  });
  res.cookies.set(REFRESH_COOKIE, sess.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}





