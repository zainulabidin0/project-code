import type { Plan } from "@/lib/db/schema";

export type ShopUsageAction =
  | "chat"
  | "voice"
  | "tts"
  | "cart_add"
  | "sentiment"
  | "sentiment_batch";

export interface PlanLimits {
  /** General API quota (address correction, reviews API, courier, etc.) */
  monthlyRequests: number;
  requestsPerMinute: number;
  maxProjects: number;
  maxKeysPerProject: number;
  /** Per-action ShopAssist limits — counted separately in shop_usage_logs */
  shopActionLimits: Record<ShopUsageAction, number>;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    monthlyRequests: 500,
    requestsPerMinute: 10,
    maxProjects: 1,
    maxKeysPerProject: 1,
    shopActionLimits: {
      chat: 2_000,
      voice: 500,
      tts: 500,
      cart_add: 1_000,
      sentiment: 200,
      sentiment_batch: 50,
    },
  },
  STARTER: {
    monthlyRequests: 10_000,
    requestsPerMinute: 60,
    maxProjects: 5,
    maxKeysPerProject: 3,
    shopActionLimits: {
      chat: 10_000,
      voice: 5_000,
      tts: 5_000,
      cart_add: 5_000,
      sentiment: 2_000,
      sentiment_batch: 500,
    },
  },
  PRO: {
    monthlyRequests: 100_000,
    requestsPerMinute: 200,
    maxProjects: 20,
    maxKeysPerProject: 10,
    shopActionLimits: {
      chat: 100_000,
      voice: 25_000,
      tts: 25_000,
      cart_add: 25_000,
      sentiment: 10_000,
      sentiment_batch: 2_500,
    },
  },
  ENTERPRISE: {
    monthlyRequests: Number.MAX_SAFE_INTEGER,
    requestsPerMinute: 1000,
    maxProjects: Number.MAX_SAFE_INTEGER,
    maxKeysPerProject: Number.MAX_SAFE_INTEGER,
    shopActionLimits: {
      chat: Number.MAX_SAFE_INTEGER,
      voice: Number.MAX_SAFE_INTEGER,
      tts: Number.MAX_SAFE_INTEGER,
      cart_add: Number.MAX_SAFE_INTEGER,
      sentiment: Number.MAX_SAFE_INTEGER,
      sentiment_batch: Number.MAX_SAFE_INTEGER,
    },
  },
};

export function getShopActionLimit(plan: Plan, action: ShopUsageAction): number {
  return PLAN_LIMITS[plan].shopActionLimits[action];
}

export function isUnlimitedLimit(limit: number): boolean {
  return limit >= Number.MAX_SAFE_INTEGER - 1000;
}
