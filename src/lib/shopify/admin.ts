import { joinPublicUrl } from "@/lib/shopify/oauth";

type ScriptTagInput = {
  shop: string;
  accessToken: string;
};

export async function installScriptTag({ shop, accessToken }: ScriptTagInput): Promise<void> {
  const widgetBase =
    (process.env.NEXT_PUBLIC_WIDGET_URL ?? "").trim().replace(/\/+$/, "") ||
    joinPublicUrl("/widget.js");
  const src = `${widgetBase}?shop=${encodeURIComponent(shop)}`;
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
