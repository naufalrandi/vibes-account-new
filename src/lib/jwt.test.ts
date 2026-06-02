import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
});

describe("jwt", () => {
  it("round-trips access claims", async () => {
    const { signAccessToken, verifyAccessToken } = await import("./jwt");
    const token = signAccessToken({
      sub: "u1",
      orgId: "o1",
      tenantId: null,
      orgType: "ServiceOwner",
      roles: ["SO Administrator"],
    });
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe("u1");
    expect(claims.orgType).toBe("ServiceOwner");
  });
});
