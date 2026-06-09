import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { assertQuotaOk } from "@/lib/usage/quota";
import { shopUsageLogs } from "@/lib/db/schema";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { getGroqKey } from "@/lib/groq/client";
import { synthesizeReplyAudio } from "@/lib/shopify/tts";

export const runtime = "nodejs";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  lang: z.enum(["en", "ar"]).optional(),
});

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const shopDomain = req.headers.get("x-shop-domain")?.trim() ?? "";
  if (!shopDomain) return jsonError("INVALID_INPUT", "Missing X-Shop-Domain header", 400);

  if (!getGroqKey()) {
    return jsonError("AI_UNAVAILABLE", "GROQ_API_KEY is not configured", 503);
  }

  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) return jsonError("NOT_FOUND", "Store not found", 404);

  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) return jsonError("RATE_LIMITED", "Monthly quota exceeded", 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.message, 400);

  try {
    const result = await synthesizeReplyAudio({
      text: parsed.data.text,
      lang: parsed.data.lang,
    });

    const chunks = result.chunks.map((buf) => buf.toString("base64"));

    await db.insert(shopUsageLogs).values({
      projectId: store.projectId,
      storeId: store.id,
      actionType: "tts",
      tokensUsed: 0,
      processingMs: Date.now() - startedAt,
      status: "SUCCESS",
    });

    return NextResponse.json({
      success: true,
      data: {
        chunks,
        lang: result.lang,
        contentType: "audio/wav",
      },
    });
  } catch (err) {
    console.error("[shopify/speak] TTS failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(
      "AI_UNAVAILABLE",
      err instanceof Error ? err.message : "Text-to-speech failed",
      503
    );
  }
}
