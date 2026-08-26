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

// Datana (cyber pentest + software delivery), field shapes sourced from OD's `js/datana.js`
// (`dnSeedIfNeeded`, `dnEngForm`/`dnFindingForm`). Covers dn-findings, the richest of the five
// modules (severity enum, CVSS range, engagement reference).
describe("datana business area — dn-findings field shape", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("uses Datana's own code stem (VF-) and default status (Open)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const eng = (await request(app).post("/v1/business/datana/dn-engagements").set(authed(a.token))
      .send({ title: "Mobile Banking App Assessment", data: { clientId: "DNC-0001", testType: "Mobile / API" } })).body.data;
    expect(eng.code).toBe("PT-0001");
    expect(eng.status).toBe("Scoping");

    const finding = (await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Broken authentication on session token", data: { engagementId: eng.id, severity: "Critical", cvss: 9.1, category: "A07 Identification & Auth", asset: "api.bank.example" } })).body.data;
    expect(finding.code).toBe("VF-0001");
    expect(finding.status).toBe("Open");
    expect(finding.data.severity).toBe("Critical");
    expect(finding.data.cvss).toBe(9.1);

    const got = await request(app).get("/v1/business/datana/dn-findings").set(authed(a.token));
    expect(got.body.data).toHaveLength(1);
    expect(got.body.data[0].data.asset).toBe("api.bank.example");
  });

  it("rejects a finding with no engagement reference", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Orphan finding", data: { severity: "High" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ENGAGEMENT_ID_REQUIRED");
  });

  it("rejects an unknown severity", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Weird severity", data: { engagementId: "PT-0001", severity: "Apocalyptic" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEVERITY");
  });

  it("rejects CVSS out of the 0-10 range", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Bad CVSS", data: { engagementId: "PT-0001", severity: "Low", cvss: 11 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CVSS");
  });

  it("rejects an unknown finding status", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Bad status", status: "Nope", data: { engagementId: "PT-0001", severity: "Low" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("updates a finding's status and severity, keeping the engagement reference", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = (await request(app).post("/v1/business/datana/dn-findings").set(authed(a.token))
      .send({ title: "Stored XSS in product review", data: { engagementId: "PT-0001", severity: "High", cvss: 7.2 } })).body.data;

    const upd = await request(app).put(`/v1/business/datana/dn-findings/${created.id}`).set(authed(a.token))
      .send({ status: "Fixed", data: { engagementId: "PT-0001", severity: "High", cvss: 7.2, status: "will be ignored — top-level only" } });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe("Fixed");
    expect(upd.body.data.data.engagementId).toBe("PT-0001");

    const upd2 = await request(app).put(`/v1/business/datana/dn-findings/${created.id}`).set(authed(a.token))
      .send({ data: {} });
    expect(upd2.status).toBe(400);
    expect(upd2.body.error.code).toBe("ENGAGEMENT_ID_REQUIRED");
  });
});
