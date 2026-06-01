import { joinPublicUrl, normalizePublicAppUrl } from "@/lib/shopify/oauth";

type ScriptTagInput = {
  shop: string;
  accessToken: string;
};

export async function fetchShopifyShopName(shop: string, accessToken: string): Promise<string> {
  const res = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });
  if (!res.ok) throw new Error("Failed to load shop name");
  const data = (await res.json()) as { shop?: { name?: string } };
  return data.shop?.name?.trim() || shop;
}

export async function registerAppUninstalledWebhook({
  shop,
  accessToken,
}: ScriptTagInput): Promise<void> {
  const address = joinPublicUrl("/api/shopify/webhooks");
  const res = await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      webhook: {
        topic: "app/uninstalled",
        address,
        format: "json",
      },
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to register app/uninstalled webhook");
  }
}

export type ThemeInfo = {
  name: string;
  themeVersion: "os1" | "os2" | "unknown";
};

export async function getThemeInfo(shop: string, accessToken: string): Promise<ThemeInfo> {
  const res = await fetch(`https://${shop}/admin/api/2024-01/themes.json?role=main`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("SHOPIFY_AUTH_REVOKED");
  }
  if (!res.ok) {
    return { name: "Unknown", themeVersion: "unknown" };
  }
  const data = (await res.json()) as {
    themes?: Array<{
      name?: string;
      theme_store_id?: number | null;
      processing?: boolean;
    }>;
  };
  const theme = data.themes?.[0];
  const isOnlineStore2 =
    theme?.theme_store_id != null && theme?.processing === false;
  return {
    name: theme?.name?.trim() || "Unknown",
    themeVersion: isOnlineStore2 ? "os2" : theme ? "os1" : "unknown",
  };
}

export async function installScriptTag({ shop, accessToken }: ScriptTagInput): Promise<void> {
  const widgetBase =
    (process.env.NEXT_PUBLIC_WIDGET_URL ?? "").trim().replace(/\/+$/, "") ||
    joinPublicUrl("/widget.js");
  const apiBase = encodeURIComponent(normalizePublicAppUrl());
  const src = `${widgetBase}?shop=${encodeURIComponent(shop)}&api=${apiBase}`;
  const res = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      script_tag: { event: "onload", src },
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to install Shopify script tag");
  }
}
