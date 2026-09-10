export const WORKSPACE = "/workspace";
export const SANDBOX_TIMEOUT = 30 * 60_000;
export const IDLE_MINUTES = 10;
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example.`);
  return value;
}
export function missingConfig() {
  return [
    "DATABASE_URL",
    "APP_PASSWORD",
    "AUTH_SECRET",
    "OPENAI_API_KEY",
    "OPENAI_EXECUTOR_API_KEY",
    "OPENAI_AGENT_ID",
    "OPENAI_WEBHOOK_SECRET",
    "CRON_SECRET",
  ].filter((key) => !process.env[key]);
}
