import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const SC = [ACTIONS.SCOPE_READ, ACTIONS.SCOPE_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = SC): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("scope datasets", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("ships the SP-global master pick-lists (envs / ptypes / deps)", async () => {
    const { token } = await makeTenant("sd1", "SD1");
    const envs = (await request(app).get("/v1/scope/datasets?kind=env").set(authed(token))).body.data;
    const ptypes = (await request(app).get("/v1/scope/datasets?kind=ptype").set(authed(token))).body.data;
    const deps = (await request(app).get("/v1/scope/datasets?kind=dep").set(authed(token))).body.data;
    expect(envs).toHaveLength(26);
    expect(ptypes).toHaveLength(4);
    expect(deps).toHaveLength(84);
    // Dependencies carry a category.
    expect(deps.find((d: { name: string }) => d.name === "Cloud Hosting Provider").category).toBe("Cloud and Infrastructure");
    expect(envs.every((e: { orgId: string | null }) => e.orgId === null)).toBe(true);
    // Invalid kind rejected.
    expect((await request(app).get("/v1/scope/datasets?kind=bogus").set(authed(token))).status).toBe(400);
  });

  it("tenants add their own custom entries, scoped per tenant", async () => {
    const a = await makeTenant("sd2", "SD2");
    const b = await makeTenant("sd3", "SD3");
    const created = await request(app).post("/v1/scope/datasets").set(authed(a.token)).send({ kind: "dep", name: "In-house Courier", category: "Operational Suppliers" });
    expect(created.body.data).toMatchObject({ kind: "dep", name: "In-house Courier", orgId: a.orgId });
    // A sees global (84) + own (1) = 85 deps; B sees only global 84.
    expect((await request(app).get("/v1/scope/datasets?kind=dep").set(authed(a.token))).body.data).toHaveLength(85);
    expect((await request(app).get("/v1/scope/datasets?kind=dep").set(authed(b.token))).body.data).toHaveLength(84);
    // B cannot edit A's entry.
    expect((await request(app).put(`/v1/scope/datasets/${created.body.data.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);
    // A can delete its own.
    expect((await request(app).delete(`/v1/scope/datasets/${created.body.data.id}`).set(authed(a.token))).status).toBe(200);
    expect((await request(app).get("/v1/scope/datasets?kind=dep").set(authed(a.token))).body.data).toHaveLength(84);
  });

  it("enforces action grants", async () => {
    const noGrant = await makeTenant("sd4", "SD4", []);
    expect((await request(app).get("/v1/scope/datasets").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("sd5", "SD5", [ACTIONS.SCOPE_READ]);
    expect((await request(app).get("/v1/scope/datasets?kind=env").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/scope/datasets").set(authed(readonly.token)).send({ kind: "env", name: "x" })).status).toBe(403);
  });
});
