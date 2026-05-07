import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopifyStores } from "@/lib/db/schema";
import { normalizeShopHost } from "@/lib/shopify/oauth";

export function normalizeShopDomain(value: string): string {
  return normalizeShopHost(value);
}

export async function getActiveStoreByDomain(shopDomain: string) {
  const rows = await db
    .select()
    .from(shopifyStores)
    .where(
      and(
        eq(shopifyStores.shopDomain, normalizeShopDomain(shopDomain)),
        eq(shopifyStores.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
