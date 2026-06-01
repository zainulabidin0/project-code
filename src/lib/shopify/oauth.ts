import crypto from "crypto";

const SHOPIFY_SCOPES = ["read_products", "write_script_tags", "write_checkouts"].join(",");

/** Trims and removes trailing slashes from NEXT_PUBLIC_APP_URL (avoids // in OAuth redirect_uri). */
export function normalizePublicAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
}

/** Joins public app base with a path that starts with /. */
export function joinPublicUrl(path: string): string {
  const base = normalizePublicAppUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Shopify OAuth host only: strips protocol, path, query.
 * Accepts "mystore.myshopify.com" or "https://mystore.myshopify.com/".
 */
export function normalizeShopHost(shop: string): string {
  let s = shop.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^\/+/, "");
  const host = s.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
  return host.replace(/\.+$/, "");
}

export function getInstallUrl(shop: string, state: string): string {
  const shopHost = normalizeShopHost(shop);
  if (!shopHost || !shopHost.includes(".")) {
    throw new Error("Invalid shop domain");
  }
  const redirectUri = joinPublicUrl("/api/shopify/callback");
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID ?? "",
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shopHost}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeToken(shop: string, code: string): Promise<string> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });
  if (!res.ok) throw new Error("Failed to exchange Shopify OAuth token");
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Shopify token missing in OAuth response");
  return data.access_token;
}

export function verifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature, ...rest } = query;
  if (!hmac || !secret) return false;
  void signature;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  if (digest.length !== hmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(hmac, "hex"));
  } catch {
    return false;
  }
}
