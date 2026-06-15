import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { reviews, shopUsageLogs, shopifyStores } from "@/lib/db/schema";
import { assertQuotaOk, countMonthlyUsage } from "@/lib/usage/quota";
import { predictSentiment, predictSentimentBatch } from "@/lib/sentiment/client";
import { getProjectNetScore } from "@/lib/sentiment/score";
import { getActiveStoreByDomain } from "@/lib/shopify/store";
import { PLAN_LIMITS } from "@/lib/rate-limit/plans";
import type { z } from "zod";
import type {
  sentimentBatchRequestSchema,
  singleSentimentRequestSchema,
} from "@/lib/validations/sentiment";

type StoreRow = typeof shopifyStores.$inferSelect;
type SingleInput = z.infer<typeof singleSentimentRequestSchema>;
type BatchInput = z.infer<typeof sentimentBatchRequestSchema>;

export function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

export async function requireShopifyStore(
  shopDomain: string
): Promise<
  | { ok: true; store: StoreRow }
  | { ok: false; code: string; message: string; status: number }
> {
  const store = await getActiveStoreByDomain(shopDomain);
  if (!store) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Shopify store is not configured",
      status: 404,
    };
  }
  if (store.authStatus === "REAUTH_REQUIRED") {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Shopify connection requires re-authentication",
      status: 401,
    };
  }
  return { ok: true, store };
}

function enrichMeta(
  store: StoreRow,
  meta: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    source: "shopify-product-page",
    shopDomain: store.shopDomain,
    ...meta,
  };
}

async function logUsage(
  store: StoreRow,
  actionType: string,
  processingMs: number,
  status: "SUCCESS" | "ERROR" = "SUCCESS"
) {
  await db.insert(shopUsageLogs).values({
    projectId: store.projectId,
    storeId: store.id,
    actionType,
    tokensUsed: 0,
    processingMs,
    status,
  });
}

export async function runShopifySentiment(
  store: StoreRow,
  input: SingleInput,
  ip: string | null
) {
  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) {
    return {
      ok: false as const,
      code: "QUOTA_EXCEEDED",
      message: "Monthly quota exceeded for your plan.",
      status: 429,
    };
  }

  const t0 = Date.now();
  let ml: Awaited<ReturnType<typeof predictSentiment>>;
  try {
    ml = await predictSentiment(input.review);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Model error";
    await logUsage(store, "sentiment", Date.now() - t0, "ERROR");
    return {
      ok: false as const,
      code: "MODEL_UNAVAILABLE",
      message: msg,
      status: 503,
    };
  }
  const processingMs = Date.now() - t0;

  const reviewerMeta = enrichMeta(
    store,
    input.reviewerMeta as Record<string, unknown> | undefined
  );

  const [row] = await db
    .insert(reviews)
    .values({
      projectId: store.projectId,
      reviewText: input.review,
      sentiment: ml.sentiment,
      score: ml.score,
      confidence: ml.confidence,
      reviewerName: input.reviewerName ?? null,
      reviewerMeta: JSON.stringify(reviewerMeta),
      processingMs,
      ip,
    })
    .returning();

  const projectNetScore = await getProjectNetScore(store.projectId);
  await logUsage(store, "sentiment", processingMs);

  return {
    ok: true as const,
    data: {
      id: row.id,
      review: row.reviewText,
      sentiment: row.sentiment,
      score: row.score,
      confidence: row.confidence ?? ml.confidence,
      reviewerName: row.reviewerName,
      processingMs,
      projectNetScore,
    },
  };
}

export async function runShopifySentimentBatch(
  store: StoreRow,
  input: BatchInput,
  ip: string | null
) {
  const items = input.reviews;
  const quota = await assertQuotaOk(store.projectId);
  if (!quota.ok) {
    return {
      ok: false as const,
      code: "QUOTA_EXCEEDED",
      message: "Monthly quota exceeded for your plan.",
      status: 429,
    };
  }

  const monthly = await countMonthlyUsage(store.projectId);
  const limit = PLAN_LIMITS[quota.plan].monthlyRequests;
  if (limit < Number.MAX_SAFE_INTEGER - 1000 && monthly + items.length > limit) {
    return {
      ok: false as const,
      code: "QUOTA_EXCEEDED",
      message: "Batch would exceed monthly quota",
      status: 429,
    };
  }

  const t0 = Date.now();
  let batch: {
    results: {
      review: string;
      sentiment: "POSITIVE" | "NEGATIVE";
      score: number;
      confidence: number;
    }[];
  };
  try {
    batch = await predictSentimentBatch(items.map((i) => i.review));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Model error";
    await logUsage(store, "sentiment_batch", Date.now() - t0, "ERROR");
    return {
      ok: false as const,
      code: "MODEL_UNAVAILABLE",
      message: msg,
      status: 503,
    };
  }
  const processingMs = Date.now() - t0;

  const out: {
    id: string;
    review: string;
    sentiment: "POSITIVE" | "NEGATIVE";
    score: number;
    confidence: number;
  }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const r = batch.results[i]!;
    const reviewerMeta = enrichMeta(
      store,
      item.reviewerMeta as Record<string, unknown> | undefined
    );
    const [row] = await db
      .insert(reviews)
      .values({
        projectId: store.projectId,
        reviewText: item.review,
        sentiment: r.sentiment,
        score: r.score,
        confidence: r.confidence,
        reviewerName: item.reviewerName ?? null,
        reviewerMeta: JSON.stringify(reviewerMeta),
        processingMs: Math.max(0, Math.floor(processingMs / items.length)),
        ip,
      })
      .returning();
    out.push({
      id: row.id,
      review: row.reviewText,
      sentiment: row.sentiment,
      score: row.score,
      confidence: row.confidence ?? r.confidence,
    });
  }

  const projectNetScore = await getProjectNetScore(store.projectId);
  await logUsage(store, "sentiment_batch", processingMs);

  return {
    ok: true as const,
    data: { results: out, projectNetScore, processingMs },
  };
}
