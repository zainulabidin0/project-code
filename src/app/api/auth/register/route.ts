import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { registerSchema } from "@/lib/validations/auth";
import { hashPassword } from "@/lib/auth/password";
import { jsonError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
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
      "Too many registration attempts.",
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

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.flatten().formErrors.join(", "), 400);
  }

  const { email, password, name } = parsed.data;
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (existing.length) {
    return jsonError("INVALID_INPUT", "Email already registered", 400);
  }

  const verifyToken = createId();
  const id = createId();
  await db.insert(users).values({
    id,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    name: name ?? null,
    verifyToken,
    emailVerified: false,
  });

  return NextResponse.json({
    success: true,
    data: {
      userId: id,
      message:
        "Account created. Verify email with /api/auth/verify-email?token=... (check token in dev).",
      devVerifyToken: process.env.NODE_ENV !== "production" ? verifyToken : undefined,
    },
  });
}
