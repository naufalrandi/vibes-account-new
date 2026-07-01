import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Site, Subscription } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeSo(superAdmin = true, actions: string[] = []): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: superAdmin, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

const provisionBody = (mode: "draft" | "activate", name = "Acme") => ({
  organization: { name, industry: "Manufacturing", country: "ID" },
  primarySite: { name: "Acme HQ", type: "Head Office", country: "ID" },
  admin: { fullName: "Acme Admin", username: `acme.${name.toLowerCase()}`, email: `admin@${name.toLowerCase()}.io` },
  mode,
});

describe("tenants", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("forbids a role without tenant grants", async () => {
    const { token } = await makeSo(false, []);
    const res = await request(app).get("/v1/tenants").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("provisions a draft tenant with org + primary site + admin + subscription", async () => {
    const { token } = await makeSo();
    const res = await request(app).post("/v1/tenants").set(authed(token)).send(provisionBody("draft"));
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^TEN-\d+$/);
    expect(res.body.data.status).toBe("Draft");
    expect(res.body.data.acquisitionSource).toBe("Direct");
    expect(res.body.data.primarySite.isPrimary).toBe(true);
    expect(res.body.data.admin.status).toBe("PendingActivation");
    expect(res.body.data.siteCount).toBe(1);

    const org = await Organization.findByPk(res.body.data.id);
    expect(org?.type).toBe("Tenant");
    expect(org?.tenantId).toBe(org?.id);
    expect(await Site.count({ where: { orgId: res.body.data.id, isPrimary: true } })).toBe(1);
    expect(await Subscription.findOne({ where: { orgId: res.body.data.id } })).not.toBeNull();
  });

  it("runs the full lifecycle: send-activation → activate → suspend → resume → deactivate → reactivate", async () => {
    const { token } = await makeSo();
    const created = await request(app).post("/v1/tenants").set(authed(token)).send(provisionBody("draft"));
    const id = created.body.data.id;
    const post = (action: string) => request(app).post(`/v1/tenants/${id}/${action}`).set(authed(token));

    // Illegal: cannot activate a Draft tenant directly.
    expect((await post("activate")).status).toBe(409);

    expect((await post("send-activation")).body.data.status).toBe("Pending Activation");
    expect((await post("activate")).body.data.status).toBe("Active");
    expect((await post("suspend")).body.data.status).toBe("Suspended");
    expect((await post("resume")).body.data.status).toBe("Active");
    expect((await post("deactivate")).body.data.status).toBe("Inactive");
    expect((await post("reactivate")).body.data.status).toBe("Active");
    // Illegal once Active again: reactivate requires Inactive.
    expect((await post("reactivate")).status).toBe(409);
  });

  it("provisions in activate mode straight to Pending Activation", async () => {
    const { token } = await makeSo();
    const res = await request(app).post("/v1/tenants").set(authed(token)).send(provisionBody("activate", "Sendco"));
    expect(res.body.data.status).toBe("Pending Activation");
  });

  it("scopes tenants — a Tenant sees only itself", async () => {
    const { token: soToken } = await makeSo();
    await request(app).post("/v1/tenants").set(authed(soToken)).send(provisionBody("draft", "Alpha"));
    await request(app).post("/v1/tenants").set(authed(soToken)).send(provisionBody("draft", "Beta"));
    const soList = await request(app).get("/v1/tenants").set(authed(soToken));
    expect(soList.body.data.length).toBe(2);

    // An active tenant user of Alpha.
    const alpha = soList.body.data.find((t: { name: string }) => t.name === "Alpha");
    const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: alpha.id, isSuperAdmin: false, status: true });
    await grantActions(role.id, [ACTIONS.TENANT_READ]);
    const u = await User.create({
      orgId: alpha.id, tenantId: alpha.id, fullName: "Alpha Admin", username: "alpha.active", email: "a@alpha.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "alpha.active", password: "ChangeMe123" });
    const list = await request(app).get("/v1/tenants").set(authed(login.body.data.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe("Alpha");
  });
});
