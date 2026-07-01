import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions = MS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "T", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("ISO clause registers (implementation)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a register entry with an auto code and lists it back", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/context").set(authed(token))
      .send({ title: "New privacy regulation", status: "Monitored", owner: "MS Team", data: { domain: "Regulatory" } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ module: "context", code: "OCX-0001", title: "New privacy regulation", status: "Monitored" });

    const list = await request(app).get("/v1/implementation/context").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].code).toBe("OCX-0001");
    // Second entry auto-increments the code.
    const second = await request(app).post("/v1/implementation/context").set(authed(token)).send({ title: "Second" });
    expect(second.body.data.code).toBe("OCX-0002");
    expect(second.body.data.status).toBe("Open"); // default = first status in the set
  });

  it("derives riskScore/riskLevel for the risks module", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/risks").set(authed(token))
      .send({ title: "Phishing", data: { likelihood: 4, impact: 4, treatment: "Mitigate" } });
    expect(created.body.data.data).toMatchObject({ riskScore: 16, riskLevel: "Major" });
    const updated = await request(app).put(`/v1/implementation/risks/${created.body.data.id}`).set(authed(token))
      .send({ data: { likelihood: 1, impact: 2 } });
    expect(updated.body.data.data).toMatchObject({ riskScore: 2, riskLevel: "Negligible" });
  });

  it("rejects an unknown module and an invalid status", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    expect((await request(app).get("/v1/implementation/not-a-module").set(authed(token))).status).toBe(404);
    const bad = await request(app).post("/v1/implementation/policies").set(authed(token)).send({ title: "P", status: "Bogus" });
    expect(bad.status).toBe(400);
    // A valid deep-module status is accepted.
    const ok = await request(app).post("/v1/implementation/policies").set(authed(token)).send({ title: "Security Policy", status: "Published" });
    expect(ok.status).toBe(201);
  });

  it("scopes register entries per tenant", async () => {
    const a = await makeTenant("t1", "TEN1");
    const b = await makeTenant("t2", "TEN2");
    const created = await request(app).post("/v1/implementation/risks").set(authed(a.token)).send({ title: "A risk", data: { likelihood: 3, impact: 3 } });
    const id = created.body.data.id;
    expect((await request(app).get("/v1/implementation/risks").set(authed(b.token))).body.data).toHaveLength(0);
    // B cannot edit or delete A's entry.
    expect((await request(app).put(`/v1/implementation/risks/${id}`).set(authed(b.token)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).delete(`/v1/implementation/risks/${id}`).set(authed(b.token))).status).toBe(403);
    // A can delete its own.
    expect((await request(app).delete(`/v1/implementation/risks/${id}`).set(authed(a.token))).status).toBe(200);
    expect((await request(app).get("/v1/implementation/risks").set(authed(a.token))).body.data).toHaveLength(0);
  });

  it("requires the ms action grants", async () => {
    const noGrant = await makeTenant("t3", "TEN3", []);
    expect((await request(app).get("/v1/implementation/risks").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("t4", "TEN4", [ACTIONS.MS_READ]);
    expect((await request(app).get("/v1/implementation/risks").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/implementation/risks").set(authed(readonly.token)).send({ title: "x" })).status).toBe(403);
  });
});
