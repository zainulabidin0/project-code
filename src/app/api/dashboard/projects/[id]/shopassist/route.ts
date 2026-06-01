import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getAccessPayload } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { projects, shopUsageLogs, shopifyStores } from "@/lib/db/schema";

export const runtime = "nodejs";

type Params = { params: { id: string } };

const patchSchema = z.object({
  widgetPosition: z.enum(["bottom-right", "bottom-left"]).optional(),
  widgetColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  widgetGreeting: z.string().min(1).max(300).optional(),
  disconnect: z.boolean().optional(),
});

async function assertProject(userId: string, projectId: string) {
  const row = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row[0] ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  if (!(await assertProject(access.sub, params.id))) {
    return jsonError("NOT_FOUND", "Project not found", 404);
  }

  const [store] = await db
    .select()
    .from(shopifyStores)
    .where(eq(shopifyStores.projectId, params.id))
    .limit(1);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const usage = await db
    .select({
      actionType: shopUsageLogs.actionType,
      count: sql<number>`count(*)::int`,
    })
    .from(shopUsageLogs)
    .where(and(eq(shopUsageLogs.projectId, params.id), gte(shopUsageLogs.createdAt, monthStart)))
    .groupBy(shopUsageLogs.actionType);

  return NextResponse.json({
    success: true,
    data: {
      store: store
        ? {
            id: store.id,
            shopDomain: store.shopDomain,
            isActive: store.isActive,
            authStatus: store.authStatus,
            themeVersion: store.themeVersion,
            hasStorefrontToken: Boolean(store.storefrontToken),
            widgetPosition: store.widgetPosition,
            widgetColor: store.widgetColor,
            widgetGreeting: store.widgetGreeting,
          }
        : null,
      usage: usage.reduce<Record<string, number>>((acc, row) => {
        acc[row.actionType] = row.count;
        return acc;
      }, {}),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await getAccessPayload(req);
  if (!access) return jsonError("UNAUTHORIZED", "Unauthorized", 401);
  if (!(await assertProject(access.sub, params.id))) {
    return jsonError("NOT_FOUND", "Project not found", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  const [store] = await db
    .select({ id: shopifyStores.id })
    .from(shopifyStores)
    .where(eq(shopifyStores.projectId, params.id))
    .limit(1);
  if (!store) return jsonError("NOT_FOUND", "Shopify store is not connected", 404);

  if (parsed.data.disconnect) {
    await db
      .update(shopifyStores)
      .set({ isActive: false, authStatus: "UNINSTALLED", uninstalledAt: new Date() })
      .where(eq(shopifyStores.id, store.id));
    return NextResponse.json({ success: true });
  }

  await db
    .update(shopifyStores)
    .set({
      ...(parsed.data.widgetPosition && { widgetPosition: parsed.data.widgetPosition }),
      ...(parsed.data.widgetColor && { widgetColor: parsed.data.widgetColor }),
      ...(parsed.data.widgetGreeting && { widgetGreeting: parsed.data.widgetGreeting }),
    })
    .where(eq(shopifyStores.id, store.id));

  return NextResponse.json({ success: true });
}
