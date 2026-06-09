import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shopCustomerProfiles } from "@/lib/db/schema";
import type { CheckoutDraft } from "@/lib/shopify/types";

/**
 * Look up a saved customer profile by email or phone for a given store.
 * Returns the saved CheckoutDraft or null if not found.
 */
export async function getSavedCustomerProfile(params: {
  storeId: string;
  identifier: string;
}): Promise<CheckoutDraft | null> {
  const rows = await db
    .select()
    .from(shopCustomerProfiles)
    .where(
      and(
        eq(shopCustomerProfiles.storeId, params.storeId),
        eq(shopCustomerProfiles.identifier, params.identifier.toLowerCase().trim())
      )
    )
    .limit(1);

  if (!rows[0]) return null;

  try {
    return JSON.parse(rows[0].checkoutDraft) as CheckoutDraft;
  } catch {
    return null;
  }
}

/**
 * Save or update a customer profile after a successful checkout collection.
 * Called once all 8 fields are collected (status === "complete").
 * Uses upsert — creates if not exists, updates if exists.
 */
export async function upsertCustomerProfile(params: {
  storeId: string;
  identifier: string;
  identifierType: "email" | "phone";
  draft: CheckoutDraft;
}): Promise<void> {
  const identifier = params.identifier.toLowerCase().trim();
  const draftJson = JSON.stringify(params.draft);

  await db
    .insert(shopCustomerProfiles)
    .values({
      storeId: params.storeId,
      identifier,
      identifierType: params.identifierType,
      checkoutDraft: draftJson,
    })
    .onConflictDoUpdate({
      target: [shopCustomerProfiles.storeId, shopCustomerProfiles.identifier],
      set: {
        checkoutDraft: draftJson,
        updatedAt: new Date(),
      },
    });
}

/**
 * Try to find a saved profile using any known identifier in the draft.
 * Checks email first, then phone. Returns the first match found.
 */
export async function findProfileByDraft(params: {
  storeId: string;
  draft: Partial<CheckoutDraft>;
}): Promise<CheckoutDraft | null> {
  if (params.draft.email) {
    const profile = await getSavedCustomerProfile({
      storeId: params.storeId,
      identifier: params.draft.email,
    });
    if (profile) return profile;
  }
  if (params.draft.phone) {
    const { normalizePhoneE164 } = await import("@/lib/shopify/checkout-collector");
    const normalized = normalizePhoneE164(params.draft.phone);
    const profile = await getSavedCustomerProfile({
      storeId: params.storeId,
      identifier: normalized,
    });
    if (profile) return profile;
  }
  return null;
}
