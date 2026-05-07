import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return jsonError("INVALID_INPUT", "Missing token", 400);
  }

  const row = await db
    .select()
    .from(users)
    .where(eq(users.verifyToken, token))
    .limit(1);
  const user = row[0];
  if (!user) {
    return jsonError("INVALID_INPUT", "Invalid token", 400);
  }

  await db
    .update(users)
    .set({
      emailVerified: true,
      verifyToken: null,
    })
    .where(eq(users.id, user.id));

  return NextResponse.json({ success: true, message: "Email verified" });
}
