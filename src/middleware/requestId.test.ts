import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requestId } from "./requestId";

const app = express();
app.use(requestId);
app.get("/", (req, res) => res.json({ id: req.requestId }));

describe("requestId middleware", () => {
  it("echoes a well-formed client id", async () => {
    const res = await request(app).get("/").set("x-request-id", "abc-123.DEF_4");
    expect(res.headers["x-request-id"]).toBe("abc-123.DEF_4");
    expect(res.body.id).toBe("abc-123.DEF_4");
  });

  it("replaces a malformed or oversized client id with a generated one", async () => {
    for (const bad of ["has space", "<script>", "x".repeat(129)]) {
      const res = await request(app).get("/").set("x-request-id", bad);
      expect(res.headers["x-request-id"]).not.toBe(bad);
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
