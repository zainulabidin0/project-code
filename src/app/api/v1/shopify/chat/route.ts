import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertShopActionQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import {
  getOrCreateSession,
  parseMessages,
  parseSessionContext,
  saveSessionState,
} from "@/lib/shopify/session";
import {
  buildProductsAvailableMessage,
  runAgentLoop,
} from "@/lib/shopify/gpt-agent";
import type { AgentContext, ChatSessionContext, SessionMessage } from "@/lib/shopify/types";
import type { StorefrontStore } from "@/lib/shopify/storefront";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  sessionToken: z.string().min(8),
});

const LOG_PREFIX = "[shopify/chat]";

function toSessionContext(context: AgentContext): ChatSessionContext {
  return {
    checkoutDraft: context.checkoutDraft,
    cartAction: context.cartAction,
    checkoutReady: context.checkoutReady,
    cartSummary: context.cartSummary,
    lastAddedProduct: context.lastAddedProduct,
  };
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  let phase = "init";

  try {
    const startedAt = Date.now();
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

    const storefrontStore: StorefrontStore = {
      id: store.id,
      shopDomain: store.shopDomain,
      storefrontToken: store.storefrontToken,
    };

    phase = "quota";
    const quota = await assertShopActionQuotaOk(store.projectId, "chat");
    if (!quota.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "quota_exceeded",
          data: {
            message: `Monthly limit reached (${quota.used}/${quota.limit}). Please upgrade your plan.`,
            products: [],
          },
        },
        { status: 429 }
      );
    }

    phase = "session";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const session = await getOrCreateSession(store.id, parsed.data.sessionToken, ip);
    const history = parseMessages(session.messages);
    const sessionContext = parseSessionContext(session.sessionContext);

    const agentContext: AgentContext = {
      cartId: session.cartToken ?? null,
      checkoutDraft: sessionContext.checkoutDraft ?? {},
      checkoutReady: sessionContext.checkoutReady ?? false,
      cartAction: sessionContext.cartAction ?? null,
      cartSummary: sessionContext.cartSummary ?? null,
      lastSearchProducts: [],
      lastAddedProduct: sessionContext.lastAddedProduct ?? null,
      storefrontStore,
      storeId: store.id,
    };

    phase = "agent";
    let result;
    try {
      result = await runAgentLoop({
        userMessage: parsed.data.message,
        history,
        context: agentContext,
        storeName: store.storeName ?? store.shopDomain,
      });
    } catch (agentError) {
      console.error(LOG_PREFIX, "agent loop failed", { requestId, phase, error: agentError });
      const products = agentContext.lastSearchProducts ?? [];
      result = {
        reply: products.length
          ? buildProductsAvailableMessage(products)
          : "Something went wrong. Please try again.",
        updatedContext: agentContext,
        toolsUsed: [] as string[],
        products,
        checkoutReady: agentContext.checkoutReady ?? false,
        cartAction: agentContext.cartAction ?? null,
      };
    }

    const updatedMessages = [
      ...history,
      { role: "user" as const, content: parsed.data.message },
      { role: "assistant" as const, content: result.reply },
    ].slice(-20) satisfies SessionMessage[];

    phase = "save";
    saveSessionState(
      session.id,
      updatedMessages,
      toSessionContext(result.updatedContext),
      result.updatedContext.cartId
    ).catch((err) => {
      console.error(LOG_PREFIX, "Session save failed (non-fatal):", err);
    });

    phase = "usage";
    const processingMs = Date.now() - startedAt;
    db.insert(shopUsageLogs)
      .values({
        projectId: store.projectId,
        storeId: store.id,
        sessionId: session.id,
        actionType: "chat",
        tokensUsed: 0,
        processingMs,
        status: "SUCCESS",
      })
      .catch((usageError) => {
        console.error(LOG_PREFIX, "usage log insert failed (non-fatal)", {
          requestId,
          phase,
          error: usageError,
        });
      });

    console.log(LOG_PREFIX, "agent reply", {
      requestId,
      phase: "done",
      toolsUsed: result.toolsUsed,
      checkoutReady: result.checkoutReady,
      productCount: result.products?.length ?? 0,
      messagePreview: result.reply?.slice(0, 80),
    });

    return NextResponse.json({
      success: true,
      data: {
        message: result.reply,
        products: result.products ?? [],
        cartAction: result.cartAction,
        checkoutReady: result.checkoutReady,
        checkoutUrl: result.cartAction?.checkoutUrl ?? null,
        redirectToCheckout: false,
        sessionToken: parsed.data.sessionToken,
      },
    });
  } catch (error) {
    console.error(LOG_PREFIX, "Error", {
      requestId,
      phase,
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        success: false,
        error: "internal_error",
        data: {
          message: "Something went wrong. Please try again.",
          products: [],
        },
      },
      { status: 500 }
    );
  }
}
