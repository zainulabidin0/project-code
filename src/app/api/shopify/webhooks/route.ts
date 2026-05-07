import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";

function verifyWebhookHmac(rawBody: string, hmac: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

export async function POST(req: NextRequest) {
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shopDomain = req.headers.get("x-shopify-shop-domain")?.toLowerCase() ?? "";
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const body = await req.text();

  if (!shopDomain || !hmac) return jsonError("INVALID_INPUT", "Invalid webhook headers", 400);
  if (!verifyWebhookHmac(body, hmac)) return jsonError("UNAUTHORIZED", "Invalid webhook signature", 401);

  if (topic === "app/uninstalled") {
    await db
      .update(shopifyStores)
      .set({ isActive: false, uninstalledAt: new Date() })
      .where(eq(shopifyStores.shopDomain, shopDomain));
  }

  return NextResponse.json({ success: true });
}
