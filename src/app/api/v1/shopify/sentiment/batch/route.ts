import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/errors";
import { sentimentBatchRequestSchema } from "@/lib/validations/sentiment";
import {
  getClientIp,
  requireShopifyStore,
  runShopifySentimentBatch,
} from "@/lib/shopify/sentiment-handler";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const shopDomain = req.headers.get("x-shop-domain")?.trim();
  if (!shopDomain) {
    return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);
  }

  const text = await req.text();
  if (text.length > 500_000) {
    return jsonError("INVALID_INPUT", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = sentimentBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    const f = parsed.error.flatten();
    if (f.fieldErrors.reviews?.some((e) => e.includes("50"))) {
      return jsonError("BATCH_TOO_LARGE", "More than 50 reviews in batch", 400);
    }
    return jsonError("INVALID_INPUT", parsed.error.message, 400);
  }

  const resolved = await requireShopifyStore(shopDomain);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "NOT_FOUND" | "UNAUTHORIZED",
      resolved.message,
      resolved.status
    );
  }

  const result = await runShopifySentimentBatch(
    resolved.store,
    parsed.data,
    getClientIp(req)
  );

  if (!result.ok) {
    return jsonError(
      result.code as "QUOTA_EXCEEDED" | "MODEL_UNAVAILABLE",
      result.message,
      result.status
    );
  }

  return NextResponse.json({ success: true, data: result.data });
}
