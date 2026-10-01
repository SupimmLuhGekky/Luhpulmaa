import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated once at startup. Never import this module from
 * client components: it contains secrets. (`server-only` enforces that at build time.)
 */
const boolish = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : ["true", "1", "yes"].includes(v)));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "production"]).optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BANKING_PROVIDER: z.enum(["mock", "plaid", "flinks"]).optional(),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  PLAID_WEBHOOK_URL: z.string().url().optional(),
  FLINKS_CUSTOMER_ID: z.string().optional(),
  FLINKS_API_URL: z.string().url().optional(),
  FLINKS_CONNECT_URL: z.string().url().optional(),
  /** Flinks secret key, used only server-side to mint short-lived authorize tokens. */
  FLINKS_SECRET: z.string().optional(),
  /** Flinks API key (`x-api-key`) for data endpoints, when your instance requires one. */
  FLINKS_API_KEY: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("Harbour <no-reply@harbour.local>"),
  RESEND_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  /** Set by the Mac desktop app, which runs this server and its database locally for one person. */
  HARBOUR_DESKTOP: boolish,
  DEMO_MODE: boolish,
  ENABLE_BANKING: boolish,
  ENABLE_AUTOMATIONS: boolish,
  ENABLE_NOTIFICATIONS: boolish,
  ENABLE_AI_CATEGORIZATION: boolish,
  ENABLE_AI_ASSISTANT: boolish,
  ENABLE_MULTI_CURRENCY: boolish,
  ENABLE_CSV_IMPORT: boolish,
});

export type ServerEnv = z.infer<typeof schema> & { appEnv: "development" | "test" | "production" };

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  const appEnv = parsed.data.APP_ENV ?? parsed.data.NODE_ENV;
  cached = { ...parsed.data, appEnv };
  return cached;
}

export function isProduction(): boolean {
  return env().appEnv === "production";
}

/** True inside the Mac desktop app (local server and database, no email delivery). */
export function isDesktop(): boolean {
  return env().HARBOUR_DESKTOP === true;
}
