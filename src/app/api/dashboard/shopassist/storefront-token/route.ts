import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccessPayload } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { projects, shopifyStores } from "@/lib/db/schema";
import { encrypt } from "@/lib/shopify/encrypt";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  projectId: z.string().min(1),
  storefrontToken: z.string().min(10),
});

export async function POST(req: NextRequest) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, parsed.data.projectId), eq(projects.userId, access.sub)))
    .limit(1);
  if (!project) return jsonError("NOT_FOUND", "Project not found", 404);

  const [store] = await db
    .select({ id: shopifyStores.id })
    .from(shopifyStores)
    .where(eq(shopifyStores.projectId, parsed.data.projectId))
    .limit(1);
  if (!store) return jsonError("NOT_FOUND", "Shopify store is not connected", 404);

  await db
    .update(shopifyStores)
    .set({ storefrontToken: encrypt(parsed.data.storefrontToken.trim()) })
    .where(eq(shopifyStores.id, store.id));

  return NextResponse.json({ success: true });
}
