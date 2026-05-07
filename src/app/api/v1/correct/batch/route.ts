import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { correctBatchSchema } from "@/lib/validations/correction";
import { jsonError } from "@/lib/errors";
import { correctAddress } from "@/lib/correction/engine";
import { db } from "@/lib/db";
import { usageLogs } from "@/lib/db/schema";
import { assertQuotaOk, countMonthlyUsage } from "@/lib/usage/quota";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = req.headers.get("x-api-key")?.trim() ?? null;
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status
    );
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

  const parsed = correctBatchSchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.addresses?.some((e) => e.includes("50"))) {
      return jsonError("BATCH_TOO_LARGE", "More than 50 addresses", 400);
    }
    return jsonError("INVALID_INPUT", flat.formErrors.join(", ") || "Invalid input", 400);
  }

  const addresses = parsed.data.addresses;
  const quota = await assertQuotaOk(resolved.ctx.projectId);
  if (!quota.ok) {
    return jsonError("QUOTA_EXCEEDED", "Monthly quota exceeded", 429);
  }

  const used = addresses.length;
  const monthly = await countMonthlyUsage(resolved.ctx.projectId);
  const limit = PLAN_LIMITS[quota.plan].monthlyRequests;
  if (limit < Number.MAX_SAFE_INTEGER - 1000 && monthly + used > limit) {
    return jsonError("QUOTA_EXCEEDED", "Batch would exceed monthly quota", 429);
  }

  const opts = parsed.data.options;
  const regexOnly = opts?.regexOnly === true;
  const includeMeta = opts?.includeMetadata !== false;

  const results = [];
  for (const address of addresses) {
    const result = await correctAddress({ address, regexOnly });
    await db.insert(usageLogs).values({
      projectId: resolved.ctx.projectId,
      inputAddress: result.original,
      outputAddress: result.corrected,
      correctionType: result.correctionType,
      processingMs: result.processingMs,
      status: "SUCCESS",
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        null,
    });
    results.push(
      includeMeta
        ? {
            original: result.original,
            corrected: result.corrected,
            confidence: result.confidence,
            correctionType: result.correctionType,
            changes: result.changes,
            processingMs: result.processingMs,
          }
        : {
            original: result.original,
            corrected: result.corrected,
            correctionType: result.correctionType,
            processingMs: result.processingMs,
          }
    );
  }

  const res = NextResponse.json({ success: true, data: { results } });
  res.headers.set("X-RateLimit-Limit", String(resolved.rate.limit));
  res.headers.set("X-RateLimit-Remaining", String(resolved.rate.remaining));
  res.headers.set("X-RateLimit-Reset", String(resolved.rate.reset));
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    },
  });
}
