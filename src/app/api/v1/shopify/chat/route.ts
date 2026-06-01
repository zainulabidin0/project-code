import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { shopChatSessions, shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getOrCreateSession, parseMessages, saveSessionMessages } from "@/lib/shopify/session";
import { runAgent } from "@/lib/shopify/gpt-agent";
import {
  buildSearchQuery,
  searchProducts,
  addToCart,
  type StorefrontStore,
} from "@/lib/shopify/storefront";
import { parseIntent } from "@/lib/shopify/intent-parser";
import type { SessionMessage } from "@/lib/shopify/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  sessionToken: z.string().min(8),
});

const LOG_PREFIX = "[shopify/chat]";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const shopDomain = req.headers.get("x-shop-domain")?.trim();
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  console.log(LOG_PREFIX, "request", { shopDomain });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) {
    console.warn(LOG_PREFIX, "store not found", { shopDomain });
    return jsonError("NOT_FOUND", "Shopify store is not configured", 404);
  }
  console.log(LOG_PREFIX, "store resolved", {
    storeId: store.id,
    shopDomain: store.shopDomain,
    hasStorefrontToken: Boolean(store.storefrontToken),
    authStatus: store.authStatus,
  });
  if (store.authStatus === "REAUTH_REQUIRED") {
    return jsonError("UNAUTHORIZED", "Shopify connection requires re-authentication", 401);
  }
  const storefrontStore: StorefrontStore = {
    id: store.id,
    shopDomain: store.shopDomain,
    storefrontToken: store.storefrontToken,
  };

  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) {
    return jsonError("RATE_LIMITED", `Monthly quota exceeded for ${quota.plan} plan`, 429);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let session = await getOrCreateSession(store.id, parsed.data.sessionToken, ip);
  const history = parseMessages(session.messages);

  const intent = await parseIntent(parsed.data.message);
  console.log(LOG_PREFIX, "intent parsed", {
    intent: intent.intent,
    filters: intent.filters,
    variantId: intent.variantId,
    quantity: intent.quantity,
  });

  let products: Awaited<ReturnType<typeof searchProducts>> = [];
  if (intent.intent === "product_search") {
    const storefrontQuery = intent.filters
      ? buildSearchQuery(intent.filters)
      : parsed.data.message;
    console.log(LOG_PREFIX, "storefront GraphQL search starting", {
      shopDomain: storefrontStore.shopDomain,
      query: storefrontQuery,
    });
    try {
      products = await searchProducts(storefrontStore, storefrontQuery);
      console.log(LOG_PREFIX, "storefront GraphQL search result", {
        count: products.length,
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          currency: p.currency,
          variantCount: p.variants.length,
        })),
      });
    } catch (err) {
      console.error(LOG_PREFIX, "storefront GraphQL search failed", {
        shopDomain: storefrontStore.shopDomain,
        query: storefrontQuery,
        error: err instanceof Error ? err.message : String(err),
      });
      products = [];
    }
  } else {
    console.log(LOG_PREFIX, "storefront GraphQL skipped", { reason: "intent is not product_search" });
  }

  let cartAction: {
    checkoutUrl: string;
    totalPrice?: string | null;
    cartId?: string;
  } | null = null;

  if (intent.intent === "add_to_cart" && intent.variantId) {
    try {
      const qty = Math.min(10, Math.max(1, intent.quantity ?? 1));
      const cart = await addToCart({
        store: storefrontStore,
        variantId: intent.variantId,
        quantity: qty,
        cartId: session.cartToken,
      });
      await db
        .update(shopChatSessions)
        .set({ cartToken: cart.cartId })
        .where(eq(shopChatSessions.id, session.id));
      session = { ...session, cartToken: cart.cartId };
      cartAction = {
        checkoutUrl: cart.checkoutUrl,
        totalPrice: cart.totalPrice,
        cartId: cart.cartId,
      };
      console.log(LOG_PREFIX, "storefront cart updated", {
        cartId: cart.cartId,
        totalPrice: cart.totalPrice,
        checkoutUrl: cart.checkoutUrl,
      });
    } catch (err) {
      console.error(LOG_PREFIX, "storefront add to cart failed", {
        variantId: intent.variantId,
        error: err instanceof Error ? err.message : String(err),
      });
      cartAction = null;
    }
  }

  const agent = await runAgent({
    storeName: store.storeName ?? store.shopDomain,
    userMessage: parsed.data.message,
    history,
    products,
    cartAction,
    routingIntent: intent.intent,
  });
  console.log(LOG_PREFIX, "agent reply", {
    intent: agent.intent,
    messagePreview: agent.message.slice(0, 120),
  });

  const nextMessages: SessionMessage[] = [
    ...history,
    { role: "user" as const, content: parsed.data.message },
    { role: "assistant" as const, content: agent.message },
  ].slice(-20);
  await saveSessionMessages(session.id, nextMessages);

  const processingMs = Date.now() - startedAt;
  await db.insert(shopUsageLogs).values({
    projectId: store.projectId,
    storeId: store.id,
    sessionId: session.id,
    actionType: "chat",
    tokensUsed: 0,
    processingMs,
    status: "SUCCESS",
  });

  console.log(LOG_PREFIX, "response", {
    processingMs,
    productCount: products.length,
    hasCartAction: Boolean(cartAction),
  });

  return NextResponse.json({
    success: true,
    data: {
      message: agent.message,
      intent: intent.intent,
      intentAgent: agent.intent,
      products,
      cartAction,
      sessionToken: parsed.data.sessionToken,
    },
  });
}
