import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertShopActionQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { executePlan } from "@/lib/shopify/action-executor";
import { generatePlan } from "@/lib/shopify/planner";
import { composeReply } from "@/lib/shopify/reply-composer";
import {
  getOrCreateSession,
  parseMessages,
  parseSessionContext,
  saveSessionState,
} from "@/lib/shopify/session";
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
    pendingAdd: context.pendingAdd,
    lastSearchProducts: context.lastSearchProducts,
  };
}

function buildStateSnapshot(context: AgentContext): string {
  const cart = context.cartSummary
    ? `Cart: ${context.cartSummary.lines?.length ?? 0} items, PKR ${context.cartSummary.total ?? "0"}`
    : "Cart: empty";
  const checkout =
    Object.keys(context.checkoutDraft ?? {}).length > 0
      ? `Checkout collected: ${JSON.stringify(context.checkoutDraft)}`
      : "Checkout: not started";
  const checkoutReady = context.checkoutReady
    ? "Checkout URL already built (checkoutReady: true) — do NOT use checkout_url_ready unless user wants to proceed"
    : "Checkout URL not built yet (checkoutReady: false)";
  const pending = context.pendingAdd
    ? `Pending product (awaiting confirm): ${context.pendingAdd.title} x${context.pendingAdd.quantity}`
    : "";
  const lastSearch = context.lastSearchProducts?.length
    ? `Last search showed: ${context.lastSearchProducts.map((p) => p.title).join(", ")}`
    : "";
  return [cart, checkout, checkoutReady, pending, lastSearch].filter(Boolean).join("\n");
}

function buildAgentContext(
  sessionContext: ChatSessionContext,
  storefrontStore: StorefrontStore,
  storeId: string,
  cartId: string | null
): AgentContext {
  return {
    cartId,
    checkoutDraft: sessionContext.checkoutDraft ?? {},
    checkoutReady: sessionContext.checkoutReady ?? false,
    cartAction: sessionContext.cartAction ?? null,
    cartSummary: sessionContext.cartSummary ?? null,
    lastSearchProducts: sessionContext.lastSearchProducts ?? [],
    lastAddedProduct: sessionContext.lastAddedProduct ?? null,
    pendingAdd: sessionContext.pendingAdd ?? null,
    storefrontStore,
    storeId,
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

    phase = "store";
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
    const context = buildAgentContext(
      sessionContext,
      storefrontStore,
      store.id,
      session.cartToken ?? null
    );

    phase = "plan";
    const stateSnapshot = buildStateSnapshot(context);
    const { plan, usage: planUsage } = await generatePlan(parsed.data.message, history, stateSnapshot);

    console.log(LOG_PREFIX, "plan", {
      requestId,
      intent: plan.userIntent,
      template: plan.replyTemplate,
      actions: plan.actions.map((a) => a.type),
      planTokens: planUsage?.total_tokens,
    });

    phase = "execute";
    const exec = await executePlan(plan, context);

    phase = "compose";
    const { reply, usedLlmFallback, usage: composeUsage } = await composeReply(
      plan,
      exec,
      parsed.data.message
    );

    if (usedLlmFallback) {
      console.log(LOG_PREFIX, "LLM fallback used", { requestId });
    }

    const updatedContext: AgentContext = {
      ...context,
      ...exec.contextUpdates,
    };

    phase = "save";
    const updatedMessages = [
      ...history,
      { role: "user" as const, content: parsed.data.message },
      { role: "assistant" as const, content: reply },
    ].slice(-20) satisfies SessionMessage[];

    saveSessionState(
      session.id,
      updatedMessages,
      toSessionContext(updatedContext),
      updatedContext.cartId
    ).catch((err) => {
      console.error(LOG_PREFIX, "Session save failed (non-fatal):", err);
    });

    phase = "usage";
    const processingMs = Date.now() - startedAt;
    const totalTokens = (planUsage?.total_tokens ?? 0) + (composeUsage?.total_tokens ?? 0);
    db.insert(shopUsageLogs)
      .values({
        projectId: store.projectId,
        storeId: store.id,
        sessionId: session.id,
        actionType: "chat",
        tokensUsed: totalTokens,
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

    console.log(LOG_PREFIX, "hybrid reply", {
      requestId,
      usedLlmFallback,
      llmCalls: usedLlmFallback ? 2 : 1,
      totalTokens,
      checkoutReady: updatedContext.checkoutReady,
      productCount: exec.products?.length ?? 0,
      messagePreview: reply.slice(0, 80),
    });

    return NextResponse.json({
      success: true,
      data: {
        message: reply,
        products: exec.products ?? updatedContext.lastSearchProducts ?? [],
        cartAction: updatedContext.cartAction,
        checkoutReady: updatedContext.checkoutReady,
        checkoutUrl: updatedContext.cartAction?.checkoutUrl ?? null,
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
