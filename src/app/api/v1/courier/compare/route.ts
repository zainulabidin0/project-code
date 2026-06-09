import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/v1/resolve-api-key";
import { courierCompareRequestSchema } from "@/lib/validations/courier";
import { jsonError } from "@/lib/errors";
import { compareCouriers, CityMatchError } from "@/lib/courier/compare-engine";
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
  if (text.length > 5000) {
    return jsonError("INVALID_INPUT", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonError("INVALID_INPUT", "Invalid JSON", 400);
  }

  const parsed = courierCompareRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join(", ");
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

  const t0 = Date.now();
  let result;
  try {
    result = compareCouriers(parsed.data);
  } catch (err) {
    if (err instanceof CityMatchError) {
      return jsonError(
        err.result.reason === "ambiguous" ? "AMBIGUOUS_CITY" : "UNRESOLVED_CITY",
        `Could not resolve ${err.field} address to a supported city.`,
        400,
        { suggestedCities: err.result.suggestedCities }
      );
    }
    return jsonError("INTERNAL_ERROR", "Courier comparison failed", 500);
  }

  const processingMs = Date.now() - t0;

  await db.insert(usageLogs).values({
    projectId: resolved.ctx.projectId,
    inputAddress: `${parsed.data.fromAddress} -> ${parsed.data.toAddress} (${parsed.data.weightKg}kg)`,
    outputAddress: result.recommended ?? "none",
    correctionType: "NO_CHANGE",
    processingMs,
    status: "SUCCESS",
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
  });

  const res = NextResponse.json({
    success: true,
    data: { ...result, processingMs },
  });
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
