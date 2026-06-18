import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertShopActionQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { transcribeAudio } from "@/lib/shopify/whisper";

export const runtime = "nodejs";

const VOICE_QUOTA_MESSAGE =
  "Monthly voice limit reached. Please upgrade your plan.";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const shopDomain = req.headers.get("x-shop-domain")?.trim() ?? "";
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) return jsonError("NOT_FOUND", "Store not found", 404);

  const quota = await assertShopActionQuotaOk(store.projectId, "voice");
  if (!quota.ok) {
    return NextResponse.json(
      {
        success: false,
        error: "quota_exceeded",
        message: VOICE_QUOTA_MESSAGE,
        data: {
          actionType: "voice",
          used: quota.used,
          limit: quota.limit,
          plan: quota.plan,
        },
      },
      { status: 429 }
    );
  }

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
