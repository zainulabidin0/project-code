const REQUIRED_ENV_VARS = [
  "ENCRYPTION_KEY",
  "GROQ_API_KEY",
  "NVIDIA_API_KEY",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "CRON_SECRET",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error("FATAL: Missing required environment variables:");
    missing.forEach((key) => console.error(`  - ${key}`));
    throw new Error(`App cannot start: missing env vars: ${missing.join(", ")}`);
  }
}
