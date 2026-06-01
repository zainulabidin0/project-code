import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { transcribeAudio } from "@/lib/shopify/whisper";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const shopDomain = req.headers.get("x-shop-domain")?.trim() ?? "";
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) return jsonError("NOT_FOUND", "Store not found", 404);

  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) return jsonError("RATE_LIMITED", "Monthly quota exceeded", 429);

  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return jsonError("INVALID_INPUT", "audio file is required", 400);
  }

  const transcript = await transcribeAudio(audio);
  await db.insert(shopUsageLogs).values({
    projectId: store.projectId,
    storeId: store.id,
    actionType: "voice",
    tokensUsed: 0,
    processingMs: Date.now() - startedAt,
    status: "SUCCESS",
  });

  return NextResponse.json({ success: true, data: { transcript } });
}
