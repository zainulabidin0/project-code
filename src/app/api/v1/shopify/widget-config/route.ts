import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/errors";
import { getActiveStoreByDomain } from "@/lib/shopify/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop")?.trim();
  if (!shop) return jsonError("INVALID_INPUT", "Missing shop query parameter", 400);

  const store = await getActiveStoreByDomain(shop);
  if (!store) return jsonError("NOT_FOUND", "Store not found", 404);

  const res = NextResponse.json({
    success: true,
    data: {
      position: store.widgetPosition,
      color: store.widgetColor,
      greeting: store.widgetGreeting,
      storeName: store.storeName ?? store.shopDomain,
    },
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
