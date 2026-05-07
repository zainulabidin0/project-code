import { NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { jsonError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", "Invalid payload", 400);
  }

  const row = await db
    .select()
    .from(users)
    .where(
      and(eq(users.resetToken, parsed.data.token), gt(users.resetTokenExp, new Date()))
    )
    .limit(1);
  const user = row[0];
  if (!user) {
    return jsonError("INVALID_INPUT", "Invalid or expired token", 400);
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      resetToken: null,
      resetTokenExp: null,
    })
    .where(eq(users.id, user.id));

  return NextResponse.json({ success: true, message: "Password updated" });
}
