import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import type {
  CartAction,
  CartSummary,
  ChatSessionContext,
  CheckoutDraft,
  LastAddedProduct,
  PendingAdd,
  SessionMessage,
  ShopifyProduct,
} from "@/lib/shopify/types";

export const DEFAULT_SESSION_CONTEXT: ChatSessionContext = {};

export function parseMessages(raw: string): SessionMessage[] {
  try {
    const value = JSON.parse(raw) as SessionMessage[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function parseCartAction(raw: unknown): CartAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as CartAction;
  if (!action.checkoutUrl) return null;
  return {
    checkoutUrl: action.checkoutUrl,
    totalPrice: action.totalPrice ?? null,
    cartId: action.cartId,
  };
}

function parseCartSummary(raw: unknown): CartSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const summary = raw as CartSummary;
  if (!summary.checkoutUrl || !Array.isArray(summary.lines)) return null;
  return {
    itemCount: Number(summary.itemCount) || 0,
    total: summary.total ?? null,
    checkoutUrl: summary.checkoutUrl,
    lines: summary.lines,
  };
}

function parseLastAddedProduct(raw: unknown): LastAddedProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const product = raw as LastAddedProduct;
  if (!product.title) return null;
  return {
    title: product.title,
    price: product.price ?? "",
    quantity: Number(product.quantity) || 1,
  };
}

function parsePendingAdd(raw: unknown): PendingAdd | null {
  if (!raw || typeof raw !== "object") return null;
  const pending = raw as PendingAdd;
  if (!pending.variantId || !pending.title) return null;
  return {
    variantId: pending.variantId,
    title: pending.title,
    price: pending.price ?? "",
    quantity: Number(pending.quantity) || 1,
  };
}

function parseLastSearchProducts(raw: unknown): ShopifyProduct[] | null {
  if (!Array.isArray(raw)) return null;
  const products = raw.filter(
    (item): item is ShopifyProduct =>
      Boolean(item && typeof item === "object" && (item as ShopifyProduct).id && (item as ShopifyProduct).title)
  );
  return products.length ? products : null;
}

export function parseSessionContext(raw: string | null | undefined): ChatSessionContext {
  if (!raw) return { ...DEFAULT_SESSION_CONTEXT };
  try {
    const value = JSON.parse(raw) as Partial<ChatSessionContext> & Record<string, unknown>;
    const context: ChatSessionContext = {};

    if (value.checkoutDraft && typeof value.checkoutDraft === "object") {
      context.checkoutDraft = value.checkoutDraft as CheckoutDraft;
    }

    const cartAction = parseCartAction(value.cartAction);
    if (cartAction) context.cartAction = cartAction;

    if (value.checkoutReady === true) context.checkoutReady = true;

    const cartSummary = parseCartSummary(value.cartSummary);
    if (cartSummary) context.cartSummary = cartSummary;

    const lastAddedProduct = parseLastAddedProduct(value.lastAddedProduct);
    if (lastAddedProduct) context.lastAddedProduct = lastAddedProduct;

    const pendingAdd = parsePendingAdd(value.pendingAdd);
    if (pendingAdd) context.pendingAdd = pendingAdd;

    const lastSearchProducts = parseLastSearchProducts(value.lastSearchProducts);
    if (lastSearchProducts) context.lastSearchProducts = lastSearchProducts;

    return context;
  } catch {
    return { ...DEFAULT_SESSION_CONTEXT };
  }
}

/**
 * Load or create a chat session. Does not mutate messages — callers must persist
 * conversation turns only via saveSessionState() after the agent reply is ready.
 */
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
  context: ChatSessionContext,
  cartToken?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db
      .update(shopChatSessions)
      .set({
        messages: JSON.stringify(messages),
        sessionContext: JSON.stringify(context),
        ...(cartToken !== undefined ? { cartToken } : {}),
      })
      .where(eq(shopChatSessions.id, sessionId));
    return { ok: true };
  } catch (error) {
    console.error("[session] saveSessionState failed:", {
      sessionId,
      error,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
