import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function soLogin(): Promise<{ token: string; soId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, soId: so.id };
}

async function makePartner(soId: string, over: Partial<{ name: string; code: string; status: string; tier: string; country: string }> = {}) {
  return Organization.create({
    name: over.name ?? "Nusantara Cloud", code: over.code ?? "NWP", type: "Distributor", status: "Active",
    parentOrgId: soId, tenantId: null, email: "partners@nusantara.cloud", phone: null, website: null,
    country: over.country ?? "ID", address: null,
    partnerStatus: (over.status ?? "Active") as never, partnerTier: (over.tier ?? "Gold") as never, partnerCode: over.code ?? "PRT-1001",
  });
}

describe("partners", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/partners")).status).toBe(401);
  });

  it("lists Distributor partners with code/status/tier and a tenant count", async () => {
    const { token, soId } = await soLogin();
    const partner = await makePartner(soId);
    // A tenant under this partner contributes to its tenantCount.
    await Organization.create({
      name: "PT Maju", code: "MAJU", type: "Tenant", status: "Active",
      parentOrgId: partner.id, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
    });
    const res = await request(app).get("/v1/partners").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ code: "PRT-1001", name: "Nusantara Cloud", status: "Active", tier: "Gold", tenantCount: 1 });
  });

  it("filters partners by status and country and searches by name/code", async () => {
    const { token, soId } = await soLogin();
    await makePartner(soId, { name: "Nusantara Cloud", code: "PRT-1001", status: "Active", country: "ID" });
    await makePartner(soId, { name: "SecureEdge", code: "PRT-1002", status: "Pending Approval", country: "SG" });

    const byStatus = await request(app).get("/v1/partners?status=Pending%20Approval").set(bearer(token));
    expect(byStatus.body.data.map((p: { code: string }) => p.code)).toEqual(["PRT-1002"]);
    const byCountry = await request(app).get("/v1/partners?country=ID").set(bearer(token));
    expect(byCountry.body.data.map((p: { code: string }) => p.code)).toEqual(["PRT-1001"]);
    const bySearch = await request(app).get("/v1/partners?search=secure").set(bearer(token));
    expect(bySearch.body.data.map((p: { code: string }) => p.code)).toEqual(["PRT-1002"]);
  });

  it("gets a single partner and 404s for a non-partner id", async () => {
    const { token, soId } = await soLogin();
    const partner = await makePartner(soId);
    const ok = await request(app).get(`/v1/partners/${partner.id}`).set(bearer(token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe("Nusantara Cloud");
    const missing = await request(app).get(`/v1/partners/${soId}`).set(bearer(token));
    expect(missing.status).toBe(404);
  });

  it("creates a partner (Draft) with a Partner Administrator and an auto code", async () => {
    const { token } = await soLogin();
    const res = await request(app).post("/v1/partners").set(bearer(token)).send({
      name: "Fresh Partner", email: "ops@fresh.io", country: "ID", tier: "Silver",
      admin: { fullName: "Pat Admin", username: "pat.admin", email: "pat@fresh.io" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Draft");
    expect(res.body.data.tier).toBe("Silver");
    expect(res.body.data.code).toMatch(/^PRT-\d+$/);

    // The Partner Administrator exists and is pending activation.
    const users = await request(app).get(`/v1/users?username=pat.admin`).set(bearer(token));
    expect(users.body.data[0]?.status).toBe("PendingActivation");
  });

  it("rejects a duplicate admin username on create", async () => {
    const { token } = await soLogin();
    const body = { name: "P1", admin: { fullName: "A", username: "dupadmin", email: "a@p1.io" } };
    expect((await request(app).post("/v1/partners").set(bearer(token)).send(body)).status).toBe(201);
    const dup = await request(app).post("/v1/partners").set(bearer(token))
      .send({ name: "P2", admin: { fullName: "B", username: "dupadmin", email: "b@p2.io" } });
    expect(dup.status).toBe(409);
  });

  it("runs partner lifecycle transitions (suspend → resume → terminate)", async () => {
    const { token, soId } = await soLogin();
    const partner = await makePartner(soId, { status: "Active" });
    const suspended = await request(app).post(`/v1/partners/${partner.id}/suspend`).set(bearer(token));
    expect(suspended.body.data.status).toBe("Suspended");
    const resumed = await request(app).post(`/v1/partners/${partner.id}/resume`).set(bearer(token));
    expect(resumed.body.data.status).toBe("Active");
    const terminated = await request(app).post(`/v1/partners/${partner.id}/terminate`).set(bearer(token));
    expect(terminated.body.data.status).toBe("Terminated");
    // Terminating again is rejected.
    expect((await request(app).post(`/v1/partners/${partner.id}/terminate`).set(bearer(token))).status).toBe(400);
  });

  it("edits a partner's contact details and tier", async () => {
    const { token, soId } = await soLogin();
    const partner = await makePartner(soId);
    const res = await request(app).put(`/v1/partners/${partner.id}`).set(bearer(token)).send({ tier: "Bronze", phone: "+62 21 9" });
    expect(res.status).toBe(200);
    expect(res.body.data.tier).toBe("Bronze");
    expect(res.body.data.phone).toBe("+62 21 9");
  });

  it("forbids a non-Service-Owner even with a partner.read grant", async () => {
    const { soId } = await soLogin();
    const tenant = await Organization.create({
      name: "Acme", code: "ACME", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const tUser = await User.create({
      orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
    await (tUser as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
    await grantActions(role.id, [ACTIONS.PARTNER_READ]);
    void soId;
    const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
    const res = await request(app).get("/v1/partners").set(bearer(login.body.data.accessToken));
    expect(res.status).toBe(403);
  });
});
