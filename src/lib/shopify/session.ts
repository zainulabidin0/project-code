import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopChatSessions } from "@/lib/db/schema";
import type { SessionMessage } from "@/lib/shopify/types";

export function parseMessages(raw: string): SessionMessage[] {
  try {
    const value = JSON.parse(raw) as SessionMessage[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
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
