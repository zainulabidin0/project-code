import jwt from "jsonwebtoken";
import type { Plan } from "@/lib/db/schema";
import type { AccessTokenPayload, RefreshTokenPayload } from "@/types";

const ACCESS_SECRET = () =>
  process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";
const REFRESH_SECRET = () =>
  process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

export function signAccessToken(user: {
  id: string;
  email: string;
  plan: Plan;
}): string {
  const payload: Omit<AccessTokenPayload, "iat" | "exp"> = {
    sub: user.id,
    email: user.email,
    plan: user.plan,
    type: "access",
  };
  return jwt.sign(payload, ACCESS_SECRET(), { expiresIn: ACCESS_TTL_SEC });
}

export function signRefreshToken(input: {
  userId: string;
  jti: string;
  familyId: string;
}): string {
  const payload: Omit<RefreshTokenPayload, "iat" | "exp"> = {
    sub: input.userId,
    jti: input.jti,
    fam: input.familyId,
    type: "refresh",
  };
  return jwt.sign(payload, REFRESH_SECRET(), { expiresIn: REFRESH_TTL_SEC });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET()) as AccessTokenPayload;
    if (decoded.type !== "access") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET()) as RefreshTokenPayload;
    if (decoded.type !== "refresh") return null;
    return decoded;
  } catch {
    return null;
  }
}
