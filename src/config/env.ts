import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().default(8),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
