import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getOrCreateSession, parseMessages, saveSessionMessages } from "@/lib/shopify/session";
import { runAgent } from "@/lib/shopify/gpt-agent";
import { searchProducts } from "@/lib/shopify/storefront";
import type { SessionMessage } from "@/lib/shopify/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  sessionToken: z.string().min(8),
});

export async function OPTIONS() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type,X-Shop-Domain");
  return res;
}

export async function POST(req: NextRequest) {
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
  if (!store || !store.storefrontToken) return jsonError("NOT_FOUND", "Shopify store is not configured", 404);

  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) {
    return jsonError("RATE_LIMITED", `Monthly quota exceeded for ${quota.plan} plan`, 429);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const session = await getOrCreateSession(store.id, parsed.data.sessionToken, ip);
  const history = parseMessages(session.messages);

  const products = await searchProducts(store.shopDomain, store.storefrontToken, parsed.data.message).catch(() => []);
  const agent = await runAgent({
    storeName: store.storeName ?? store.shopDomain,
    userMessage: parsed.data.message,
    history,
    products,
  });

  const nextMessages: SessionMessage[] = [
    ...history,
    { role: "user", content: parsed.data.message },
    { role: "assistant", content: agent.message },
  ].slice(-20);
  await saveSessionMessages(session.id, nextMessages);

  await db.insert(shopUsageLogs).values({
    projectId: store.projectId,
    storeId: store.id,
    sessionId: session.id,
    actionType: "chat",
    tokensUsed: 0,
    processingMs: Date.now() - startedAt,
    status: "SUCCESS",
  });

  const res = NextResponse.json({
    success: true,
    data: {
      message: agent.message,
      intent: agent.intent,
      products,
      cartAction: null,
      sessionToken: parsed.data.sessionToken,
    },
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
