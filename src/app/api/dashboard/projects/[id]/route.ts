import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { updateProjectSchema } from "@/lib/validations/project";

export const runtime = "nodejs";

type Params = { params: { id: string } };

async function assertProject(userId: string, projectId: string) {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(_req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id } = params;
  const p = await assertProject(access.sub, id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);
  return NextResponse.json({ success: true, data: p });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id } = params;
  const p = await assertProject(access.sub, id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const [row] = await db
    .update(projects)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
    })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json({ success: true, data: row });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id } = params;
  const p = await assertProject(access.sub, id);
  if (!p) return jsonError("NOT_FOUND", "Project not found", 404);

  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ success: true });
}
