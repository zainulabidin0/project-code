import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { apiKeys, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function DELETE(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id: keyId } = params;

  const row = await db
    .select({ keyId: apiKeys.id })
    .from(apiKeys)
    .innerJoin(projects, eq(apiKeys.projectId, projects.id))
    .where(
      and(eq(apiKeys.id, keyId), eq(projects.userId, access.sub))
    )
    .limit(1);

  if (!row[0]) return jsonError("NOT_FOUND", "API key not found", 404);

  await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(eq(apiKeys.id, keyId));

  return NextResponse.json({ success: true });
}
