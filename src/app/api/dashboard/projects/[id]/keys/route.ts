import { NextRequest, NextResponse } from "next/server";
import { getAccessPayload } from "@/lib/auth/session";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { apiKeys, projects, users } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateApiKey } from "@/lib/api-key/generate";
import { hashApiKey } from "@/lib/api-key/hash";
import { createApiKeySchema } from "@/lib/validations/project";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id: projectId } = params;

  const proj = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, access.sub)))
    .limit(1);
  if (!proj[0]) return jsonError("NOT_FOUND", "Project not found", 404);

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId));

  return NextResponse.json({ success: true, data: keys });
}

export async function POST(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  const { id: projectId } = params;

  const proj = await db
    .select({ userId: projects.userId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, access.sub)))
    .limit(1);
  if (!proj[0]) return jsonError("NOT_FOUND", "Project not found", 404);

  const u = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, access.sub))
    .limit(1);
  const plan = u[0]?.plan ?? "FREE";
  const maxK = PLAN_LIMITS[plan].maxKeysPerProject;

  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId));
  if (c >= maxK) {
    return jsonError(
      "INVALID_INPUT",
      "API key limit reached for this project.",
      400
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const raw = generateApiKey();
  const hashed = hashApiKey(raw);
  const [row] = await db
    .insert(apiKeys)
    .values({
      hashedKey: hashed,
      name: parsed.data.name ?? "Default",
      projectId,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
    });

  return NextResponse.json({
    success: true,
    data: {
      ...row,
      key: raw,
      warning: "Store this key securely; it will not be shown again.",
    },
  });
}
