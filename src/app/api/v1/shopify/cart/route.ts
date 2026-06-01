import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getOrCreateSession } from "@/lib/shopify/session";
import { addToCart, type StorefrontStore } from "@/lib/shopify/storefront";
import { getDecryptedStorefrontToken } from "@/lib/shopify/tokens";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionToken: z.string().min(8),
  variantId: z.string().min(3),
  quantity: z.number().int().min(1).max(10).default(1),
});

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
  if (!store) return jsonError("NOT_FOUND", "Shopify store is not configured", 404);
  if (!getDecryptedStorefrontToken(store)) {
    return jsonError("NOT_FOUND", "Storefront API token is not configured", 404);
  }
  if (!parsed.data.variantId.startsWith("gid://")) {
    return jsonError("INVALID_INPUT", "Invalid variant id", 400);
  }

  const storefrontStore: StorefrontStore = {
    id: store.id,
    shopDomain: store.shopDomain,
    storefrontToken: store.storefrontToken,
  };

  const session = await getOrCreateSession(store.id, parsed.data.sessionToken, req.ip);
  const cart = await addToCart({
    store: storefrontStore,
    variantId: parsed.data.variantId,
    quantity: parsed.data.quantity,
    cartId: session.cartToken,
  });

  await db.update(shopChatSessions).set({ cartToken: cart.cartId }).where(eq(shopChatSessions.id, session.id));

  return NextResponse.json({
    success: true,
    data: {
      cartId: cart.cartId,
      checkoutUrl: cart.checkoutUrl,
      lineItems: [],
      totalPrice: cart.totalPrice,
    },
  });
}
