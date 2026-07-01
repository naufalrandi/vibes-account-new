import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

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
