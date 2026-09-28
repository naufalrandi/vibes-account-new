import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().optional(),
  // HS256 secrets must carry ≥256 bits of entropy. Generate with `openssl rand -hex 32`.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().default(8),
  // Public frontend origin that emailed links point at. Trailing slash stripped
  // so `${APP_BASE_URL}/activate` never doubles up.
  APP_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((u) => u.replace(/\/+$/, ""))
    .default("http://localhost:3000"),
  // --- outbound email (SMTP) ---
  // Without SMTP_HOST, development prints mail to the console and test captures
  // it in memory (src/lib/mailer.ts); production refuses to boot (loadEnv).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  // "true" = implicit TLS (usually port 465); "false" = STARTTLS upgrade (587).
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // RFC 5322 sender, e.g. `Vibes <no-reply@example.com>`.
  MAIL_FROM: z.string().optional(),
  // Comma-separated CORS allowlist. Defaults to the local FE origin; set the real
  // frontend origin(s) in production (never leave the API open to all origins).
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  // --- auth hardening ---
  // Express `trust proxy`. "0" (default) trusts no proxy, so a client cannot
  // spoof `req.ip` (rate limits, login history) via X-Forwarded-For. Set a hop
  // count ("1") or a comma-separated address/subnet list behind a known LB.
  TRUST_PROXY: z
    .string()
    .default("0")
    .transform((v) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : v)),
  // Stricter per-IP limiter on POST /auth/login and /auth/password/forgot.
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  // --- database pool / TLS / ops ---
  DB_POOL_MAX: z.coerce.number().int().min(2).default(10),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(0),
  DB_POOL_ACQUIRE_MS: z.coerce.number().int().positive().default(30_000),
  DB_POOL_IDLE_MS: z.coerce.number().int().positive().default(10_000),
  // "true" = require TLS to Postgres. Certificate verification stays on unless
  // DB_SSL_REJECT_UNAUTHORIZED=false (e.g. a managed DB with a private CA).
  DB_SSL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DB_SSL_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  // Grace period for in-flight requests on SIGTERM/SIGINT before a forced exit.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // --- AI connection ---
  // AES-256-GCM key sealing the stored AI provider API key (src/lib/secretBox.ts).
  // Base64 of exactly 32 bytes — generate with `openssl rand -base64 32`. Optional:
  // without it the server runs, but no AI API key can be saved or used.
  AI_ENCRYPTION_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .refine((v) => Buffer.from(v, "base64").length === 32, "AI_ENCRYPTION_KEY must be base64 of exactly 32 bytes")
      .optional(),
  ),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Production requirements that only matter for the running API server. Kept out
 * of loadEnv so `npm run migrate`, seeds and one-off scripts still run with a
 * production .env that has no mail server configured yet.
 */
export function assertServerConfig(e: Env): void {
  if (e.NODE_ENV !== "production") return;
  // Invites and password resets are emailed links: without a mail server or a
  // public APP_BASE_URL, nobody could ever activate an account.
  if (!e.SMTP_HOST || !e.MAIL_FROM) {
    throw new Error("Invalid environment: SMTP_HOST and MAIL_FROM are required in production");
  }
  const host = new URL(e.APP_BASE_URL).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    throw new Error("Invalid environment: APP_BASE_URL must be the public frontend URL in production, not localhost");
  }
}

export const env: Env = loadEnv();
