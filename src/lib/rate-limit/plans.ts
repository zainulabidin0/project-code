import type { Plan } from "@/lib/db/schema";

export interface PlanLimits {
  monthlyRequests: number;
  requestsPerMinute: number;
  maxProjects: number;
  maxKeysPerProject: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    monthlyRequests: 500,
    requestsPerMinute: 10,
    maxProjects: 1,
    maxKeysPerProject: 1,
  },
  STARTER: {
    monthlyRequests: 10_000,
    requestsPerMinute: 60,
    maxProjects: 5,
    maxKeysPerProject: 3,
  },
  PRO: {
    monthlyRequests: 100_000,
    requestsPerMinute: 200,
    maxProjects: 20,
    maxKeysPerProject: 10,
  },
  ENTERPRISE: {
    monthlyRequests: Number.MAX_SAFE_INTEGER,
    requestsPerMinute: 1000,
    maxProjects: Number.MAX_SAFE_INTEGER,
    maxKeysPerProject: Number.MAX_SAFE_INTEGER,
  },
};
