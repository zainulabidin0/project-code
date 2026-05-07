import { randomBytes } from "crypto";

const PREFIX = "af_live_";

export function generateApiKey(): string {
  const body = randomBytes(20).toString("hex"); // 40 hex chars
  return `${PREFIX}${body}`;
}
