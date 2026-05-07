import type { Plan } from "@/lib/db/schema";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  plan: Plan;
  type: "access";
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  fam: string;
  type: "refresh";
  iat: number;
  exp: number;
}

export type ApiErrorCode =
  | "INVALID_API_KEY"
  | "API_KEY_REVOKED"
  | "API_KEY_EXPIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXCEEDED"
  | "INVALID_INPUT"
  | "ADDRESS_TOO_LONG"
  | "BATCH_TOO_LARGE"
  | "AI_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND";
