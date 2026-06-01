import { decrypt } from "@/lib/shopify/encrypt";

type StoreTokens = {
  accessToken: string;
  storefrontToken: string | null;
};

export function getDecryptedAccessToken(store: Pick<StoreTokens, "accessToken">): string {
  return decrypt(store.accessToken);
}

export function getDecryptedStorefrontToken(
  store: Pick<StoreTokens, "storefrontToken">
): string | null {
  if (!store.storefrontToken?.trim()) return null;
  return decrypt(store.storefrontToken);
}
