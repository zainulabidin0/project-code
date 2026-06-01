import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/errors";
import { getInstallUrl, normalizeShopHost } from "@/lib/shopify/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shopRaw = searchParams.get("shop")?.trim();
  const projectId = searchParams.get("projectId")?.trim() ?? "";
  if (!shopRaw) {
    return jsonError("INVALID_INPUT", "shop is required", 400);
  }

  const shopHost = normalizeShopHost(shopRaw);
  if (!shopHost.endsWith(".myshopify.com")) {
    return jsonError(
      "INVALID_INPUT",
      "shop must be your store domain, e.g. mystore.myshopify.com (no https://)",
      400
    );
  }

  const state = Buffer.from(
    JSON.stringify({ ...(projectId ? { projectId } : {}), ts: Date.now() }),
    "utf8"
  ).toString("base64url");
  try {
    const redirect = getInstallUrl(shopHost, state);
    return NextResponse.redirect(redirect);
  } catch {
    return jsonError("INVALID_INPUT", "Invalid shop domain", 400);
  }
}
