import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { correctRequestSchema } from "@/lib/validations/correction";
import { jsonError } from "@/lib/errors";
import { correctAddress } from "@/lib/correction/engine";
import { db } from "@/lib/db";
import { usageLogs } from "@/lib/db/schema";
import { assertQuotaOk } from "@/lib/usage/quota";

export const runtime = "nodejs";

function getRawKey(req: NextRequest): string | null {
  return req.headers.get("x-api-key")?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  const raw = getRawKey(req);
  const resolved = await resolveApiKey(raw);
  if (!resolved.ok) {
    return jsonError(
      resolved.code as "INVALID_API_KEY",
      resolved.message,
      resolved.status,
      resolved.status === 429 ? { retryAfter: 60 } : undefined
    );
  }

  const text = await req.text();
  // 5000 is the max length of the body/address
  if (text.length > 5000) {
    return jsonError("INVALID_INPUT", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = correctRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join(", ");
    const addrErrs = parsed.error.flatten().fieldErrors.address;
    if (addrErrs?.length) {
      const a = addrErrs[0];
      if (a?.includes("1000")) {
        return jsonError("ADDRESS_TOO_LONG", "Address exceeds 1000 characters", 400);
      }
    }
    return jsonError("INVALID_INPUT", msg || "Invalid input", 400);
  }

  const quota = await assertQuotaOk(resolved.ctx.projectId);
  if (!quota.ok) {
    return jsonError(
      "QUOTA_EXCEEDED",
      "Monthly quota exceeded for your plan.",
      429
    );
  }

  const opts = parsed.data.options;
  const regexOnly = opts?.regexOnly === true;

  let result;
  try {
    result = await correctAddress({
      address: parsed.data.address,
      regexOnly,
    });
  } catch {
    return jsonError("INTERNAL_ERROR", "Correction failed", 500);
  }

  await db.insert(usageLogs).values({
    projectId: resolved.ctx.projectId,
    inputAddress: result.original,
    outputAddress: result.corrected,
    correctionType: result.correctionType,
    processingMs: result.processingMs,
    status: "SUCCESS",
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
  });

  const includeMeta = opts?.includeMetadata !== false;
  const data = includeMeta
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
      };

  const res = NextResponse.json({ success: true, data });
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
