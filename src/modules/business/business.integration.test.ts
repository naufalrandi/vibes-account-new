import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL = [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE];

async function actor(code: string, username: string, actions: string[]) {
  const org = await Organization.create({ name: code, code, type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: `${code} User`, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `${code} R`, tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

describe("business unit registers", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires business.read", async () => {
    const a = await actor("SP", "noaccess", []);
    expect((await request(app).get("/v1/business/enterprise/ent-personnel").set(authed(a.token))).status).toBe(403);
  });

  it("rejects an unknown business area", async () => {
    const a = await actor("SP", "sp1", ALL);
    expect((await request(app).get("/v1/business/nope/x").set(authed(a.token))).status).toBe(404);
  });

  // OD numbers the Sales entities from their own bases with fixed stems
  // (`leadNextId` index.html:29329, `inqNextId` :29903, `propNextId` :30236, `prjNextId` :30389, `plNextId` :30513).
  it("uses OD's own code stems and numeric bases for the Sales modules", async () => {
    const a = await actor("SP", "sp1", ALL);
    const mk = (mod: string, title: string) =>
      request(app).post(`/v1/business/enterprise/${mod}`).set(authed(a.token)).send({ title });
    expect((await mk("ent-leads", "PT Sinar Jaya")).body.data.code).toBe("LD-2001");
    expect((await mk("ent-inq", "Website enquiry")).body.data.code).toBe("INQ-3001");
    expect((await mk("ent-proposals", "ISO 9001 implementation")).body.data.code).toBe("PRO-4001");
    expect((await mk("ent-projects", "ISO 9001 rollout")).body.data.code).toBe("PRJ-6001");
    expect((await mk("ent-leads-people", "Andi Wijaya")).body.data.code).toBe("PL-001");
  });

  // OD `PLATFORM` (index.html:5848-5874) carries five areas, not four —
  // `exelera` is a sister operating company with its own live modules.
  it("accepts the exelera business area", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/exelera/ex-cab").set(authed(a.token))
      .send({ title: "PT Sinar Jaya — ISO 9001", status: "Application", data: { scheme: "ISO 9001:2015" } });
    expect(res.status).toBe(201);
    expect(res.body.data.area).toBe("exelera");
    const list = await request(app).get("/v1/business/exelera/ex-cab").set(authed(a.token));
    expect(list.body.data).toHaveLength(1);
  });

  it("creates a record with an abbreviated code and lists it", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Budi Santoso", status: "Active", data: { department: "Engineering", position: "Senior Engineer" } });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("PER-0001");
    expect(res.body.data.area).toBe("enterprise");
    expect(res.body.data.data.department).toBe("Engineering");

    const list = await request(app).get("/v1/business/enterprise/ent-personnel").set(authed(a.token));
    expect(list.body.data).toHaveLength(1);
    // A second record continues the per-module sequence.
    const res2 = await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token)).send({ title: "Sari" });
    expect(res2.body.data.code).toBe("PER-0002");
    expect(res2.body.data.status).toBe("Open");
  });

  it("updates and deletes a record", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await request(app).post("/v1/business/datana/dn-pentest").set(authed(a.token)).send({ title: "Engagement A" });
    const id = created.body.data.id;
    const upd = await request(app).put(`/v1/business/datana/dn-pentest/${id}`).set(authed(a.token)).send({ status: "In Progress", data: { scope: "web" } });
    expect(upd.body.data.status).toBe("In Progress");
    expect(upd.body.data.data.scope).toBe("web");
    const del = await request(app).delete(`/v1/business/datana/dn-pentest/${id}`).set(authed(a.token));
    expect(del.status).toBe(200);
    expect((await request(app).get("/v1/business/datana/dn-pentest").set(authed(a.token))).body.data).toHaveLength(0);
  });

  it("scopes records to the acting org and by area+module", async () => {
    const a = await actor("SPA", "spa", ALL);
    const b = await actor("SPB", "spb", ALL);
    await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send({ title: "A lead" });
    await request(app).post("/v1/business/enterprise/ent-inq").set(authed(a.token)).send({ title: "A inquiry" });
    // Different module → not returned; different org → not returned.
    expect((await request(app).get("/v1/business/enterprise/ent-leads").set(authed(a.token))).body.data).toHaveLength(1);
    expect((await request(app).get("/v1/business/enterprise/ent-inq").set(authed(a.token))).body.data).toHaveLength(1);
    expect((await request(app).get("/v1/business/enterprise/ent-leads").set(authed(b.token))).body.data).toHaveLength(0);
  });

  // Wave C: Operating company scoping (AXIA vs Exelera)
  it("scopes records by company (Wave C)", async () => {
    const a = await actor("SP", "sp1", ALL);
    await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send({ title: "AXIA Lead", company: "axia" });
    await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send({ title: "Exelera Lead", company: "exelera" });

    const axiaList = await request(app).get("/v1/business/enterprise/ent-leads?company=axia").set(authed(a.token));
    expect(axiaList.body.data).toHaveLength(1);
    expect(axiaList.body.data[0].title).toBe("AXIA Lead");

    const exeleraList = await request(app).get("/v1/business/enterprise/ent-leads?company=exelera").set(authed(a.token));
    expect(exeleraList.body.data).toHaveLength(1);
    expect(exeleraList.body.data[0].title).toBe("Exelera Lead");
  });

  // Wave B-2: Server-side referential guards on lead delete
  it("blocks deleting a lead with downstream dependents (B-2)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const lead = (await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send({ title: "Acme Corp" })).body.data;
    await request(app).post("/v1/business/enterprise/ent-inq").set(authed(a.token)).send({ title: "Inquiry 1", data: { leadId: lead.code } });

    const del = await request(app).delete(`/v1/business/enterprise/ent-leads/${lead.id}`).set(authed(a.token));
    expect(del.status).toBe(400);
    expect(del.body.error.message).toMatch(/Has 1 inquiry\(s\) and 0 project\(s\) — cannot delete/);
  });

  it("blocks deleting a tenant-linked lead (B-2)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const lead = (await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send({ title: "Tenant Lead", data: { tenantId: "tn-123" } })).body.data;

    const del = await request(app).delete(`/v1/business/enterprise/ent-leads/${lead.id}`).set(authed(a.token));
    expect(del.status).toBe(400);
    expect(del.body.error.message).toBe("Tenant-linked lead — remove the tenant instead");
  });
});
