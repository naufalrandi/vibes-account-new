import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { UPLOAD_ROOT } from "./modules/cms/cmsMedia.service";

// DB-free platform behaviour: nothing here reaches a route that queries Postgres.
const app = createApp();
const probeDir = path.join(UPLOAD_ROOT, "platform-test-probe");

afterAll(() => fs.rmSync(probeDir, { recursive: true, force: true }));

describe("platform middleware", () => {
  it("/health is static", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });

  it("unknown /v1 path: 401 for anonymous callers (no route probing)", async () => {
    const res = await request(app).get("/v1/definitely-not-a-route");
    expect(res.status).toBe(401);
  });

  it("the old /v1 roles catch-all is gone — /v1/roles still requires auth", async () => {
    expect((await request(app).get("/v1/roles")).status).toBe(401);
  });

  it("unknown non-/v1 path: JSON 404 envelope", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: "NOT_FOUND" } });
  });

  it("malformed JSON body → 400 BAD_REQUEST, no stack", async () => {
    const res = await request(app).post("/v1/auth/login").set("content-type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "BAD_REQUEST", message: "Malformed request body" });
  });

  it("body over 2mb → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await request(app).post("/v1/auth/login").set("content-type", "application/json")
      .send(JSON.stringify({ pad: "x".repeat(2_200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("public CMS: non-UUID org id → 404, not a DB cast error", async () => {
    const res = await request(app).get("/v1/public/cms/not-a-uuid/posts");
    expect(res.status).toBe(404);
  });

  it("public leads: honeypot short-circuits with 202; non-UUID org → 404; bad body → 400", async () => {
    const orgId = "00000000-0000-4000-8000-000000000000";
    const bot = await request(app).post(`/v1/public/leads/${orgId}`).send({ website: "spam.example", name: "x" });
    expect(bot.status).toBe(202);
    expect((await request(app).post("/v1/public/leads/nope").send({ source: "contact", name: "A", email: "a@b.io" })).status).toBe(404);
    const bad = await request(app).post(`/v1/public/leads/${orgId}`).send({ source: "Contact Us!", name: "A", email: "a@b.io", website: "" });
    expect(bad.status).toBe(400);
  });

  it("uploads are served with nosniff/CSP and non-images as attachments", async () => {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, "doc.pdf"), "%PDF-1.4");
    const res = await request(app).get("/uploads/cms/platform-test-probe/doc.pdf");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(res.headers["content-disposition"]).toBe("attachment");
  });
});
