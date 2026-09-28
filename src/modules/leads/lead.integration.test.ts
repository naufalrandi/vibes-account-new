import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, BusinessRecord, CmsPage, AuditLog } from "../../db/models";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const url = (orgId: string) => `/v1/public/leads/${orgId}`;
const lead = { source: "axia-contact", name: "Dewi Lestari", email: "dewi@example.com", company: "PT Maju", message: "Need ISO 27001" };

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  return Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
}

describe("POST /v1/public/leads/:orgId", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("stores a Service Owner lead as an ent-inq inquiry at the pipeline entry status", async () => {
    const so = await org("ServiceOwner", "AXIA");
    const res = await request(app).post(url(so.id)).send({ ...lead, website: "", meta: { utm_source: "google" } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: expect.any(String) }, error: null });

    const row = await BusinessRecord.findByPk(res.body.data.id);
    expect(row).toMatchObject({ orgId: so.id, area: "enterprise", module: "ent-inq", status: "Cold Leads", company: "axia" });
    expect(row!.code).toMatch(/^INQ-\d{4}$/);
    expect(row!.data).toMatchObject({
      leadName: "PT Maju", contactName: "Dewi Lestari", contactEmail: "dewi@example.com",
      source: "axia-contact", lifecycle: "Unassigned",
    });
    expect(String(row!.data.notes)).toContain("utm_source: google");
    expect(await AuditLog.count({ where: { action: "lead.received" } })).toBe(1);
  });

  it("accepts leads for an org with a live (Published) CMS site", async () => {
    const t = await org("Tenant", "TEN");
    await CmsPage.create({ orgId: t.id, title: "Home", slug: "home", path: null, template: "Landing", status: "Published", author: null, seoTitle: null, seoDesc: null, body: "Hi", createdBy: null });
    expect((await request(app).post(url(t.id)).send(lead)).status).toBe(201);
  });

  it("404s an org without a public site, and an unknown org", async () => {
    const t = await org("Tenant", "TEN");
    expect((await request(app).post(url(t.id)).send(lead)).status).toBe(404);
    expect((await request(app).post(url("11111111-1111-4111-8111-111111111111")).send(lead)).status).toBe(404);
  });

  it("filled honeypot → silent 202, nothing stored", async () => {
    const so = await org("ServiceOwner", "AXIA");
    const res = await request(app).post(url(so.id)).send({ ...lead, website: "http://spam" });
    expect(res.status).toBe(202);
    expect(await BusinessRecord.count()).toBe(0);
  });

  it("validates the body", async () => {
    const so = await org("ServiceOwner", "AXIA");
    expect((await request(app).post(url(so.id)).send({ ...lead, email: "nope" })).status).toBe(400);
    expect((await request(app).post(url(so.id)).send({ ...lead, source: "Bad Source" })).status).toBe(400);
    expect((await request(app).post(url(so.id)).send({ ...lead, name: "" })).status).toBe(400);
    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect((await request(app).post(url(so.id)).send({ ...lead, meta: tooMany })).status).toBe(400);
  });

  it("accepts the CMS contact form's urlencoded post", async () => {
    const so = await org("ServiceOwner", "AXIA");
    const res = await request(app).post(url(so.id)).type("form").send("source=contact&name=Budi&email=budi%40x.io&message=Hello&website=");
    expect(res.status).toBe(201);
  });

  it("rate-limits to 5 per minute per IP", async () => {
    const so = await org("ServiceOwner", "AXIA");
    for (let i = 0; i < 5; i++) expect((await request(app).post(url(so.id)).send(lead)).status).toBe(201);
    expect((await request(app).post(url(so.id)).send(lead)).status).toBe(429);
  });
});
