import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getOrCreateSession } from "@/lib/shopify/session";
import { addToCart } from "@/lib/shopify/storefront";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionToken: z.string().min(8),
  variantId: z.string().min(3),
  quantity: z.number().int().min(1).max(10).default(1),
});

export async function OPTIONS() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type,X-Shop-Domain");
  return res;
}

export async function POST(req: NextRequest) {
  const shopDomain = req.headers.get("x-shop-domain")?.trim();
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store || !store.storefrontToken) return jsonError("NOT_FOUND", "Shopify store is not configured", 404);

  const session = await getOrCreateSession(store.id, parsed.data.sessionToken, req.ip);
  const cart = await addToCart({
    shopDomain: store.shopDomain,
    storefrontToken: store.storefrontToken,
    variantId: parsed.data.variantId,
    quantity: parsed.data.quantity,
    cartId: session.cartToken,
  });

  await db.update(shopChatSessions).set({ cartToken: cart.cartId }).where(eq(shopChatSessions.id, session.id));

  const res = NextResponse.json({
    success: true,
    data: {
      cartId: cart.cartId,
      checkoutUrl: cart.checkoutUrl,
      lineItems: [],
      totalPrice: null,
    },
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
