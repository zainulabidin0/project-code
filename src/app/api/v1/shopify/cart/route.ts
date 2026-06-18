import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/errors";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getOrCreateSession, parseSessionContext, saveSessionContext } from "@/lib/shopify/session";
import { addToCart, type StorefrontStore } from "@/lib/shopify/storefront";

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
  if (store.authStatus === "REAUTH_REQUIRED") {
    return jsonError("UNAUTHORIZED", "Shopify connection requires re-authentication", 401);
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
  const sessionContext = parseSessionContext(session.sessionContext);
  const cart = await addToCart({
    store: storefrontStore,
    variantId: parsed.data.variantId,
    quantity: parsed.data.quantity,
    cartId: session.cartToken,
  });

  await db
    .update(shopChatSessions)
    .set({ cartToken: cart.cartId })
    .where(eq(shopChatSessions.id, session.id));

  await saveSessionContext(session.id, {
    ...sessionContext,
    cartAction: {
      checkoutUrl: cart.checkoutUrl,
      totalPrice: cart.totalPrice,
    },
    checkoutReady: false,
  });

  const totalLine = cart.totalPrice ? ` Cart total: ${cart.totalPrice}` : "";

  return NextResponse.json({
    success: true,
    data: {
      cartId: cart.cartId,
      totalPrice: cart.totalPrice,
      checkoutUrl: cart.checkoutUrl,
      message: `Added to your cart!${totalLine}`,
      checkoutReady: false,
    },
  });
}
