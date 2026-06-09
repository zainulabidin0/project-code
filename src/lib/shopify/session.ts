import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import type { ChatSessionContext, SessionMessage } from "@/lib/shopify/types";

export const DEFAULT_SESSION_CONTEXT: ChatSessionContext = {
  stage: "greeting",
};

export function parseMessages(raw: string): SessionMessage[] {
  try {
    const value = JSON.parse(raw) as SessionMessage[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function parseSessionContext(raw: string | null | undefined): ChatSessionContext {
  if (!raw) return { ...DEFAULT_SESSION_CONTEXT };
  try {
    const value = JSON.parse(raw) as Partial<ChatSessionContext>;
    const stage = value.stage;
    const validStage =
      stage === "greeting" ||
      stage === "no_results" ||
      stage === "presenting_options" ||
      stage === "selecting_variant" ||
      stage === "awaiting_quantity" ||
      stage === "awaiting_cart_confirm" ||
      stage === "awaiting_confirm" ||
      stage === "cart_added_pause" ||
      stage === "collecting_checkout" ||
      stage === "checkout_ready" ||
      stage === "completed"
        ? stage
        : "greeting";
    return {
      stage: validStage,
      lastProducts: Array.isArray(value.lastProducts) ? value.lastProducts : undefined,
      selectedProduct: value.selectedProduct,
      selectedVariantId:
        typeof value.selectedVariantId === "string" ? value.selectedVariantId : undefined,
      selectedQuantity:
        typeof value.selectedQuantity === "number" &&
        Number.isFinite(value.selectedQuantity) &&
        value.selectedQuantity >= 1
          ? Math.min(10, Math.round(value.selectedQuantity))
          : undefined,
      lastSearchQuery:
        typeof value.lastSearchQuery === "string" ? value.lastSearchQuery : undefined,
      checkoutDraft:
        value.checkoutDraft && typeof value.checkoutDraft === "object"
          ? (value.checkoutDraft as ChatSessionContext["checkoutDraft"])
          : undefined,
      checkoutField:
        typeof value.checkoutField === "string" ? (value.checkoutField as ChatSessionContext["checkoutField"]) : undefined,
    };
  } catch {
    return { ...DEFAULT_SESSION_CONTEXT };
  }
}

export async function getOrCreateSession(
  storeId: string,
  sessionToken: string,
  ip?: string | null
) {
  const existing = await db
    .select()
    .from(shopChatSessions)
    .where(
      and(
        eq(shopChatSessions.storeId, storeId),
        eq(shopChatSessions.sessionToken, sessionToken)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(shopChatSessions)
    .values({
      storeId,
      sessionToken,
      ip: ip ?? null,
      messages: "[]",
      sessionContext: JSON.stringify(DEFAULT_SESSION_CONTEXT),
    })
    .returning();
  return created;
}

export async function saveSessionMessages(sessionId: string, messages: SessionMessage[]) {
  await db
    .update(shopChatSessions)
    .set({ messages: JSON.stringify(messages) })
    .where(eq(shopChatSessions.id, sessionId));
}

export async function saveSessionContext(sessionId: string, context: ChatSessionContext) {
  await db
    .update(shopChatSessions)
    .set({ sessionContext: JSON.stringify(context) })
    .where(eq(shopChatSessions.id, sessionId));
}

export async function saveSessionState(
  sessionId: string,
  messages: SessionMessage[],
  context: ChatSessionContext
) {
  await db
    .update(shopChatSessions)
    .set({
      messages: JSON.stringify(messages),
      sessionContext: JSON.stringify(context),
    })
    .where(eq(shopChatSessions.id, sessionId));
}
