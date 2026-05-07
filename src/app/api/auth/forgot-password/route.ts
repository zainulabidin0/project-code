import { NextRequest, NextResponse } from "next/server";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
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
    return NextResponse.json({ success: true }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: true });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: true });
  }

  const token = createId();
  const exp = new Date(Date.now() + 60 * 60 * 1000);

  await db
    .update(users)
    .set({ resetToken: token, resetTokenExp: exp })
    .where(eq(users.email, parsed.data.email.toLowerCase()));

  return NextResponse.json({
    success: true,
    message: "If an account exists, a reset link was sent.",
    devResetToken:
      process.env.NODE_ENV !== "production" ? token : undefined,
  });
}
