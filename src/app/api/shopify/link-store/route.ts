import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccessPayload } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { projects, shopifyStores } from "@/lib/db/schema";
import { decrypt } from "@/lib/shopify/encrypt";
import { jsonError } from "@/lib/errors";
import {
  fetchShopifyShopName,
  getThemeInfo,
  installScriptTag,
  registerAppUninstalledWebhook,
} from "@/lib/shopify/admin";
import { normalizeShopHost } from "@/lib/shopify/oauth";

export const runtime = "nodejs";

const bodySchema = z.object({
  projectId: z.string().min(1),
  shopDomain: z.string().min(3),
  encryptedToken: z.string().min(1),
  storeName: z.string().optional(),
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

  const shopDomain = normalizeShopHost(parsed.data.shopDomain);
  let accessToken: string;
  try {
    accessToken = decrypt(parsed.data.encryptedToken);
  } catch {
    return jsonError("INVALID_INPUT", "Invalid encrypted token", 400);
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, parsed.data.projectId), eq(projects.userId, access.sub)))
    .limit(1);
  if (!project) return jsonError("NOT_FOUND", "Project not found", 404);

  const existingForProject = await db
    .select({ id: shopifyStores.id })
    .from(shopifyStores)
    .where(eq(shopifyStores.projectId, parsed.data.projectId))
    .limit(1);

  let themeVersion: "os1" | "os2" | "unknown" = "unknown";
  try {
    const theme = await getThemeInfo(shopDomain, accessToken);
    themeVersion = theme.themeVersion;
  } catch {
    themeVersion = "unknown";
  }

  await registerAppUninstalledWebhook({ shop: shopDomain, accessToken }).catch(() => null);
  await installScriptTag({ shop: shopDomain, accessToken }).catch(() => null);

  const storeName =
    parsed.data.storeName?.trim() ||
    (await fetchShopifyShopName(shopDomain, accessToken).catch(() => shopDomain));

  if (existingForProject[0]) {
    await db
      .update(shopifyStores)
      .set({
        shopDomain,
        accessToken: parsed.data.encryptedToken,
        storeName,
        isActive: true,
        authStatus: "ACTIVE",
        themeVersion,
        uninstalledAt: null,
      })
      .where(eq(shopifyStores.id, existingForProject[0].id));
  } else {
    const existingByDomain = await db
      .select({ id: shopifyStores.id, projectId: shopifyStores.projectId })
      .from(shopifyStores)
      .where(eq(shopifyStores.shopDomain, shopDomain))
      .limit(1);

    if (existingByDomain[0] && existingByDomain[0].projectId !== parsed.data.projectId) {
      await db
        .update(shopifyStores)
        .set({
          projectId: parsed.data.projectId,
          accessToken: parsed.data.encryptedToken,
          storeName,
          isActive: true,
          authStatus: "ACTIVE",
          themeVersion,
          uninstalledAt: null,
        })
        .where(eq(shopifyStores.id, existingByDomain[0].id));
    } else if (!existingByDomain[0]) {
      await db.insert(shopifyStores).values({
        projectId: parsed.data.projectId,
        shopDomain,
        storeName,
        accessToken: parsed.data.encryptedToken,
        isActive: true,
        authStatus: "ACTIVE",
        themeVersion,
      });
    }
  }

  return NextResponse.json({ success: true });
}
