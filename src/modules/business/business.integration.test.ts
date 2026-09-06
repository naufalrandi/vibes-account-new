import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
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
    const mk = (mod: string, title: string, data?: Record<string, unknown>) =>
      request(app).post(`/v1/business/enterprise/${mod}`).set(authed(a.token)).send({ title, data });
    expect((await mk("ent-leads", "PT Sinar Jaya")).body.data.code).toBe("LD-2001");
    expect((await mk("ent-inq", "Website enquiry")).body.data.code).toBe("INQ-3001");
    // AXI-43's `proposalRules.ts` requires `currency` on every proposal — supply the minimum
    // valid payload so this test can still assert on the code stem alone.
    expect((await mk("ent-proposals", "ISO 9001 implementation", { currency: "IDR" })).body.data.code).toBe("PRO-4001");
    expect((await mk("ent-projects", "ISO 9001 rollout")).body.data.code).toBe("PRJ-6001");
    expect((await mk("ent-leads-people", "Andi Wijaya")).body.data.code).toBe("PL-001");
  });

  // SOF-25: BIZ_CODE_CONFIG entries newly registered for previously-unregistered
  // (generic-fallback-prefix) Business Unit modules.
  it("mints codes from the newly registered BIZ_CODE_CONFIG entries", async () => {
    const a = await actor("SP", "sp1", ALL);
    const mk = (area: string, mod: string, title: string, data?: Record<string, unknown>) =>
      request(app).post(`/v1/business/${area}/${mod}`).set(authed(a.token)).send({ title, data });
    // OD's own generators set these bases: `prNextId` starts at PR-3001
    // (js/modules.js:2927) and `poNextId` at PO-5001 (:3758).
    expect((await mk("enterprise", "ent-pr", "Developer laptops")).body.data.code).toBe("PR-3001");
    expect((await mk("enterprise", "ent-po", "Stark Industries Supply")).body.data.code).toBe("PO-5001");
    expect((await mk("exelera", "ex-cab", "PT Sinar Jaya — ISO 9001")).body.data.code).toBe("CB-1001");
    expect((await mk("motoran", "mb-vehicle", "B 1234 XY")).body.data.code).toBe("MB-0001");
    expect((await mk("motoran", "mb-booking", "Fleet booking")).body.data.code).toBe("BK-0001");
    expect((await mk("motoran", "mb-support", "Flat tyre")).body.data.code).toBe("TK-0001");
    expect((await mk("enterprise", "ent-comp", "Base salary")).body.data.code).toBe("COMP-0001");
    expect((await mk("enterprise", "ent-payroll", "August 2026 cycle")).body.data.code).toBe("PY-1");
    expect((await mk("enterprise", "ent-minwage", "DKI Jakarta 2026")).body.data.code).toBe("MW-0001");
    expect((await mk("enterprise", "ent-db-courses", "ISO 9001 Lead Auditor")).body.data.code).toBe("CRS-0001");
    expect((await mk("enterprise", "ent-ctypes", "Permanent")).body.data.code).toBe("CT-001");
    expect((await mk("enterprise", "ent-svc-ctypes", "Retainer")).body.data.code).toBe("SCT-001");
    expect((await mk("enterprise", "ent-sup-ctypes", "Framework agreement")).body.data.code).toBe("PCT-001");
    expect((await mk("enterprise", "ent-ss", "BPJS Kesehatan")).body.data.code).toBe("SS-0001");

    // `ent-recruitment` numbers job openings and candidates from two different
    // bases in the same module, keyed by `data.entity`.
    expect((await mk("enterprise", "ent-recruitment", "Backend Engineer")).body.data.code).toBe("JOB-1001");
    expect((await mk("enterprise", "ent-recruitment", "Backend Engineer #2")).body.data.code).toBe("JOB-1002");
    expect((await mk("enterprise", "ent-recruitment", "Andi Wijaya", { entity: "candidate" })).body.data.code).toBe("CAN-2001");
    expect((await mk("enterprise", "ent-recruitment", "Budi Santoso", { entity: "candidate" })).body.data.code).toBe("CAN-2002");

    // SOF-25 second batch.
    expect((await mk("enterprise", "ent-svc-contracts", "Garuda Tech — ISO 9001 implementation")).body.data.code).toBe("SC-5001");
    expect((await mk("enterprise", "ent-leave", "Annual leave — Cindy Moon")).body.data.code).toBe("LV-4001");
    expect((await mk("enterprise", "ent-holidays", "Independence Day")).body.data.code).toBe("HOL-6001");
    expect((await mk("enterprise", "ent-banks", "Bank Mandiri")).body.data.code).toBe("BNK-9001");
    expect((await mk("enterprise", "ent-po-terms", "Governing law")).body.data.code).toBe("POT-001");
    expect((await mk("enterprise", "ent-ctype-profiles", "PKWTT · ID")).body.data.code).toBe("CTP-001");
    expect((await mk("enterprise", "ent-ctype-templates", "PKWTT — Permanent Employment")).body.data.code).toBe("CTT-001");
    expect((await mk("enterprise", "ent-db-disciplines", "Quality and Safety")).body.data.code).toBe("CD-001");
    expect((await mk("enterprise", "ent-fiscal", "Jan 2026")).body.data.code).toBe("FP-01");

    // SOF-25 third batch — Exelera scope datasets + groups.
    expect((await mk("exelera", "ex-sp-envs", "Production Environment")).body.data.code).toBe("SDENV-0001");
    expect((await mk("exelera", "ex-sp-deps", "Cloud Hosting Provider")).body.data.code).toBe("SDDEP-0001");
    expect((await mk("exelera", "ex-sp-ptypes", "Employee (Permanent Contract)")).body.data.code).toBe("SDPT-0001");
    expect((await mk("exelera", "ex-groups", "Standards")).body.data.code).toBe("GRP-001");
  });

  // SOF-25: the three new transition graphs (service contracts, leave, fiscal periods) plus the
  // entry status every graph-gated module now defaults to instead of the generic "Open".
  it("defaults a graph-gated module to its entry status and enforces its graph", async () => {
    const a = await actor("SP", "sp1", ALL);
    const mk = (mod: string, title: string, status?: string) =>
      request(app).post(`/v1/business/enterprise/${mod}`).set(authed(a.token)).send({ title, status });
    const move = (mod: string, id: string, status: string) =>
      request(app).put(`/v1/business/enterprise/${mod}/${id}`).set(authed(a.token)).send({ status });

    const contract = await mk("ent-svc-contracts", "Garuda Tech — ISO 9001");
    expect(contract.body.data.status).toBe("Draft");
    expect((await move("ent-svc-contracts", contract.body.data.id, "Signed")).status).toBe(400); // Draft → Signed skips Issued
    expect((await move("ent-svc-contracts", contract.body.data.id, "Issued")).status).toBe(200);

    const leave = await mk("ent-leave", "Annual leave — Cindy Moon");
    expect(leave.body.data.status).toBe("Pending Approval");
    expect((await move("ent-leave", leave.body.data.id, "Approved")).status).toBe(200);
    expect((await move("ent-leave", leave.body.data.id, "Cancelled")).status).toBe(400); // Approved is terminal

    const period = await mk("ent-fiscal", "Jan 2026");
    expect(period.body.data.status).toBe("Open");
    expect((await move("ent-fiscal", period.body.data.id, "Closed")).status).toBe(200);
    expect((await move("ent-fiscal", period.body.data.id, "Open")).status).toBe(200); // reopen is legal (fiscalPeriodClose toggles)

    // Create may pick any status the graph knows, but not a word outside it.
    expect((await mk("ent-leave", "Sick leave", "Needs Revision")).body.data.status).toBe("Needs Revision");
    expect((await mk("ent-leave", "Sick leave", "Escalated")).status).toBe(400);
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

  // Wave B-3: `plDelete` (app.html:30599) carries no referential guard — a
  // person lead deletes unconditionally even when an inquiry converted from
  // it still exists, because the converted inquiry never references the
  // person lead's id/code (`plConvert` stamps `leadId:''`, app.html:30600).
  it("deletes a person lead with no dependent-inquiry guard, even one sharing its code as a leadId (B-3)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const person = (await request(app).post("/v1/business/enterprise/ent-leads-people").set(authed(a.token)).send({ title: "Andi Wijaya" })).body.data;
    // Even an inquiry that happens to carry the person lead's code as its
    // leadId (which real `plConvert` output never does) must not block the
    // delete — the guard is intentionally absent for this module, not merely
    // unmatched.
    await request(app).post("/v1/business/enterprise/ent-inq").set(authed(a.token)).send({ title: "Converted inquiry", data: { leadId: person.code } });

    const del = await request(app).delete(`/v1/business/enterprise/ent-leads-people/${person.id}`).set(authed(a.token));
    expect(del.status).toBe(200);
    expect((await request(app).get("/v1/business/enterprise/ent-leads-people").set(authed(a.token))).body.data).toHaveLength(0);
  });

  // BE-10: Server-side lead duplicate detection. OD's uniqueness key is legal
  // name + organization type + country, not the display name alone
  // (app.html:29334-29338), scoped by the active operating company.
  describe("lead duplicate detection (BE-10)", () => {
    const ptAcme = (overrides: Record<string, unknown> = {}) => ({
      title: "PT Acme",
      data: { legal: { orgType: "PT", legalName: "PT Acme" }, country: "ID" },
      ...overrides,
    });

    it("blocks a second lead with the same legal name, org type, and country", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme());
      expect(first.status).toBe(201);

      const second = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme());
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("DUPLICATE_LEAD");
      expect(second.body.error.message).toBe(`Already registered as ${first.body.data.code} — PT PT Acme`);
    });

    it("is case-insensitive on legal name", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme());
      expect(first.status).toBe(201);

      const second = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token))
        .send(ptAcme({ title: "pt acme", data: { legal: { orgType: "PT", legalName: "pt acme" }, country: "ID" } }));
      expect(second.status).toBe(409);
    });

    it("allows the same name with a different organization type (CV vs PT)", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme());
      expect(first.status).toBe(201);

      const second = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token))
        .send(ptAcme({ data: { legal: { orgType: "CV", legalName: "PT Acme" }, country: "ID" } }));
      expect(second.status).toBe(201);
    });

    it("allows the same name and org type in a different country", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme());
      expect(first.status).toBe(201);

      const second = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token))
        .send(ptAcme({ data: { legal: { orgType: "PT", legalName: "PT Acme" }, country: "SG" } }));
      expect(second.status).toBe(201);
    });

    it("does not collide across operating companies (AXIA vs Exelera)", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme({ company: "axia" }));
      expect(first.status).toBe(201);

      const second = await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme({ company: "exelera" }));
      expect(second.status).toBe(201);
    });

    it("excludes the record itself when updating (no false positive on save)", async () => {
      const a = await actor("SP", "sp1", ALL);
      const lead = (await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme())).body.data;

      const upd = await request(app).put(`/v1/business/enterprise/ent-leads/${lead.id}`).set(authed(a.token)).send({ status: "Qualified" });
      expect(upd.status).toBe(200);
      expect(upd.body.data.status).toBe("Qualified");
    });

    it("blocks updating a second lead into a collision with an existing one", async () => {
      const a = await actor("SP", "sp1", ALL);
      const first = (await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token)).send(ptAcme())).body.data;
      const second = (await request(app).post("/v1/business/enterprise/ent-leads").set(authed(a.token))
        .send(ptAcme({ title: "PT Beta", data: { legal: { orgType: "PT", legalName: "PT Beta" }, country: "ID" } }))).body.data;

      const upd = await request(app).put(`/v1/business/enterprise/ent-leads/${second.id}`).set(authed(a.token))
        .send({ title: "PT Acme", data: { legal: { orgType: "PT", legalName: "PT Acme" }, country: "ID" } });
      expect(upd.status).toBe(409);
      expect(upd.body.error.code).toBe("DUPLICATE_LEAD");
      expect(upd.body.error.message).toBe(`Already registered as ${first.code} — PT PT Acme`);
    });
  });
});

// P0-7 / Wave C: the company filter must be a mandatory tenancy boundary,
// not an opt-in one. An absent `company` must resolve to OD's own default
// ('axia'), never to "no filter — return everything" (C-2), and a
// cross-company id lookup on get/update/delete must 404 exactly like a
// nonexistent id (C-3) instead of leaking existence via a different status
// code. Garbage company input is a 400, never silently coerced (C-4), and
// company is immutable after creation (C-5).
describe("business company tenancy boundary (P0-7 / Wave C)", () => {
  // A sibling top-level `describe` does not inherit the `beforeAll`/`afterEach`
  // declared inside "business unit registers" — vitest hooks are scoped to
  // their own block. Redeclaring `resetDb()` here keeps each test isolated
  // (and `initModels()` is idempotent, so re-calling it is a no-op).
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  const uniqueActor = (actions: string[]) => {
    const id = randomUUID().slice(0, 8);
    return actor(`SP-${id}`, `sp-${id}`, actions);
  };
  it("excludes an exelera record from an axia-scoped list", async () => {
    const a = await uniqueActor(ALL);
    await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" });

    const axiaList = await request(app).get("/v1/business/enterprise/ent-personnel?company=axia").set(authed(a.token));
    expect(axiaList.status).toBe(200);
    expect(axiaList.body.data).toHaveLength(0);
  });

  it("excludes an exelera record from a list with no company param at all (defaults to axia, not everything)", async () => {
    const a = await uniqueActor(ALL);
    await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" });

    const unscopedList = await request(app).get("/v1/business/enterprise/ent-personnel").set(authed(a.token));
    expect(unscopedList.status).toBe(200);
    expect(unscopedList.body.data).toHaveLength(0);
  });

  it("404s an update against an exelera record when scoped as axia", async () => {
    const a = await uniqueActor(ALL);
    const created = (await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" })).body.data;

    const upd = await request(app).put(`/v1/business/enterprise/ent-personnel/${created.id}?company=axia`).set(authed(a.token))
      .send({ status: "Active" });
    expect(upd.status).toBe(404);
    expect(upd.body.error.code).toBe("RECORD_NOT_FOUND");
  });

  it("404s a delete against an exelera record when scoped as axia", async () => {
    const a = await uniqueActor(ALL);
    const created = (await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" })).body.data;

    const del = await request(app).delete(`/v1/business/enterprise/ent-personnel/${created.id}?company=axia`).set(authed(a.token));
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("RECORD_NOT_FOUND");
  });

  it("still finds and mutates the exelera record when scoped correctly as exelera", async () => {
    const a = await uniqueActor(ALL);
    const created = (await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" })).body.data;

    const upd = await request(app).put(`/v1/business/enterprise/ent-personnel/${created.id}?company=exelera`).set(authed(a.token))
      .send({ status: "Active" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe("Active");
  });

  it("stores an explicitly-requested exelera company as exelera, not silently defaulted to axia", async () => {
    const a = await uniqueActor(ALL);
    const created = (await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Exelera Person", company: "exelera" })).body.data;
    expect(created.company).toBe("exelera");
  });

  it("rejects create with an unrecognized company as 400 INVALID_COMPANY instead of silently coercing to axia", async () => {
    const a = await uniqueActor(ALL);
    const res = await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Bogus Co Person", company: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COMPANY");
  });

  it("rejects list with an unrecognized company as 400 INVALID_COMPANY", async () => {
    const a = await uniqueActor(ALL);
    const res = await request(app).get("/v1/business/enterprise/ent-personnel?company=bogus").set(authed(a.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COMPANY");
  });

  it("does not let an update move a record from axia to exelera", async () => {
    const a = await uniqueActor(ALL);
    const created = (await request(app).post("/v1/business/enterprise/ent-personnel").set(authed(a.token))
      .send({ title: "Axia Person", company: "axia" })).body.data;
    expect(created.company).toBe("axia");

    const upd = await request(app).put(`/v1/business/enterprise/ent-personnel/${created.id}?company=axia`).set(authed(a.token))
      .send({ company: "exelera", status: "Active" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.company).toBe("axia");

    // Still findable under axia, not exelera — the move never happened.
    const axiaList = await request(app).get("/v1/business/enterprise/ent-personnel?company=axia").set(authed(a.token));
    expect(axiaList.body.data.map((r: { id: string }) => r.id)).toContain(created.id);
    const exeleraList = await request(app).get("/v1/business/enterprise/ent-personnel?company=exelera").set(authed(a.token));
    expect(exeleraList.body.data.map((r: { id: string }) => r.id)).not.toContain(created.id);
  });
});
