import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { updateAccountSchema } from "@/lib/validations/project";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  const row = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, access.sub))
    .limit(1);

  if (!row[0]) return jsonError("NOT_FOUND", "User not found", 404);
  return NextResponse.json({ success: true, data: row[0] });
}

export async function PATCH(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = updateAccountSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const [row] = await db
    .update(users)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    })
    .where(eq(users.id, access.sub))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
    });

  return NextResponse.json({ success: true, data: row });
}
