import { describe, expect, it, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { rateLimit, resetRateLimits } from "./rateLimit";
import { errorHandler } from "./error";

function makeApp(max: number, windowMs = 60_000) {
  const app = express();
  app.use(express.json());
  app.post("/try", rateLimit({ windowMs, max, keyPrefix: "test" }), (_req, res) => {
    res.status(200).json({ success: true, data: { ok: true }, error: null, meta: null });
  });
  app.use(errorHandler);
  return app;
}

describe("rateLimit middleware", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests up to the limit then returns 429 with a consistent envelope", async () => {
    const app = makeApp(2);
    expect((await request(app).post("/try")).status).toBe(200);
    expect((await request(app).post("/try")).status).toBe(200);

    const blocked = await request(app).post("/try");
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.data).toBeNull();
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("resetRateLimits clears the buckets", async () => {
    const app = makeApp(1);
    expect((await request(app).post("/try")).status).toBe(200);
    expect((await request(app).post("/try")).status).toBe(429);
    resetRateLimits();
    expect((await request(app).post("/try")).status).toBe(200);
  });
});
