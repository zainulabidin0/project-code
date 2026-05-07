import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, shopifyStores } from "@/lib/db/schema";
import { jsonError } from "@/lib/errors";
import { exchangeToken, joinPublicUrl, normalizeShopHost, verifyHmac } from "@/lib/shopify/oauth";
import { installScriptTag } from "@/lib/shopify/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const shop = normalizeShopHost(query.shop ?? "");
  const code = query.code?.trim();
  const state = query.state?.trim();
  const hmacOk = verifyHmac(query, process.env.SHOPIFY_CLIENT_SECRET ?? "");

  if (!shop || !code || !state || !hmacOk) {
    return jsonError("INVALID_INPUT", "Invalid OAuth callback", 400);
  }

  let projectId = "";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { projectId?: string };
    projectId = parsed.projectId ?? "";
  } catch {
    return jsonError("INVALID_INPUT", "Invalid OAuth state", 400);
  }
  if (!projectId) return jsonError("INVALID_INPUT", "Project not provided", 400);

  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project[0]) return jsonError("NOT_FOUND", "Project not found", 404);

  const accessToken = await exchangeToken(shop, code);
  const storefrontToken = process.env.SHOPIFY_STOREFRONT_TOKEN ?? null;

  const existing = await db
    .select({ id: shopifyStores.id })
    .from(shopifyStores)
    .where(eq(shopifyStores.projectId, projectId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(shopifyStores)
      .set({
        shopDomain: shop,
        accessToken,
        storefrontToken,
        isActive: true,
        uninstalledAt: null,
      })
      .where(and(eq(shopifyStores.id, existing[0].id), eq(shopifyStores.projectId, projectId)));
  } else {
    await db.insert(shopifyStores).values({
      projectId,
      shopDomain: shop,
      accessToken,
      storefrontToken,
    });
  }

  await installScriptTag({ shop, accessToken }).catch(() => null);
  return NextResponse.redirect(joinPublicUrl(`/projects/${projectId}/shopassist`));
}
