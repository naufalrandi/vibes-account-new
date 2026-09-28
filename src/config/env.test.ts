import { describe, expect, it } from "vitest";
import { assertServerConfig, loadEnv } from "./env";

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      JWT_ACCESS_SECRET: "a-32char-min-access-secret-value-xx",
      JWT_REFRESH_SECRET: "a-32char-min-refresh-secret-value-yy",
    });
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL).toBe(900);
  });

  it("throws when a required secret is missing", () => {
    expect(() => loadEnv({ DATABASE_URL: "postgres://x" })).toThrow();
  });
});

describe("loadEnv — outbound email", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    JWT_ACCESS_SECRET: "a-32char-min-access-secret-value-xx",
    JWT_REFRESH_SECRET: "a-32char-min-refresh-secret-value-yy",
  };
  const prod = { ...base, NODE_ENV: "production", SMTP_HOST: "smtp.example.com", MAIL_FROM: "Vibes <no-reply@example.com>", APP_BASE_URL: "https://app.example.com" };

  it("defaults SMTP port/secure and the local APP_BASE_URL", () => {
    const env = loadEnv({ ...base, NODE_ENV: "development" });
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("parses SMTP_SECURE and strips APP_BASE_URL's trailing slash", () => {
    const env = loadEnv({ ...base, SMTP_SECURE: "true", SMTP_PORT: "465", APP_BASE_URL: "https://app.example.com/" });
    expect(env.SMTP_SECURE).toBe(true);
    expect(env.SMTP_PORT).toBe(465);
    expect(env.APP_BASE_URL).toBe("https://app.example.com");
  });

  it("rejects a non-http(s) APP_BASE_URL", () => {
    expect(() => loadEnv({ ...base, APP_BASE_URL: "app.example.com" })).toThrow();
    expect(() => loadEnv({ ...base, APP_BASE_URL: "ftp://app.example.com" })).toThrow();
  });

  it("accepts a complete production config", () => {
    expect(loadEnv(prod).SMTP_HOST).toBe("smtp.example.com");
  });

  it("refuses production without SMTP_HOST or MAIL_FROM", () => {
    expect(() => assertServerConfig(loadEnv({ ...prod, SMTP_HOST: undefined }))).toThrow(/SMTP_HOST/);
    expect(() => assertServerConfig(loadEnv({ ...prod, MAIL_FROM: "" }))).toThrow(/MAIL_FROM/);
    // Scripts (migrate, seed) still load a production env without mail settings.
    expect(() => loadEnv({ ...prod, SMTP_HOST: undefined, MAIL_FROM: "" })).not.toThrow();
  });

  it("refuses production with a localhost APP_BASE_URL", () => {
    expect(() => assertServerConfig(loadEnv({ ...prod, APP_BASE_URL: "http://localhost:3000" }))).toThrow(/APP_BASE_URL/);
    expect(() => assertServerConfig(loadEnv({ ...prod, APP_BASE_URL: "http://127.0.0.1:3000" }))).toThrow(/APP_BASE_URL/);
    expect(() => assertServerConfig(loadEnv(prod))).not.toThrow();
  });
});

describe("loadEnv — AI_ENCRYPTION_KEY", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    JWT_ACCESS_SECRET: "a-32char-min-access-secret-value-xx",
    JWT_REFRESH_SECRET: "a-32char-min-refresh-secret-value-yy",
  };

  it("is optional, and blank counts as unset", () => {
    expect(loadEnv(base).AI_ENCRYPTION_KEY).toBeUndefined();
    expect(loadEnv({ ...base, AI_ENCRYPTION_KEY: "" }).AI_ENCRYPTION_KEY).toBeUndefined();
  });

  it("accepts base64 of 32 bytes and refuses any other length", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(loadEnv({ ...base, AI_ENCRYPTION_KEY: key }).AI_ENCRYPTION_KEY).toBe(key);
    expect(() => loadEnv({ ...base, AI_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AI_ENCRYPTION_KEY/);
  });
});
