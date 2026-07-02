import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Site } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const WU = [ACTIONS.WORKUNIT_READ, ACTIONS.WORKUNIT_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = WU): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function makeSite(orgId: string, code: string): Promise<string> {
  const s = await Site.create({ orgId, code, name: `Site ${code}`, type: "Head Office", status: "Active", isPrimary: true, country: null, address: null, description: null, contactPerson: null, contactEmail: null, contactPhone: null });
  return s.id;
}

describe("work units", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a work unit with site + sub-entities, lists, updates and archives it", async () => {
    const { token, orgId } = await makeTenant("wu1", "WU1");
    const siteId = await makeSite(orgId, "WU1");

    const created = await request(app).post("/v1/work-units").set(authed(token))
      .send({ name: "Production Line A", siteId, description: "Assembly", processIds: ["p1", "p2"], envIds: ["e1"], depIds: ["d1"] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "WKU-0001", name: "Production Line A", siteId, status: "Applicable", processIds: ["p1", "p2"], envIds: ["e1"], depIds: ["d1"] });
    const id = created.body.data.id;

    const list = await request(app).get("/v1/work-units").set(authed(token));
    expect(list.body.data).toHaveLength(1);

    const updated = await request(app).put(`/v1/work-units/${id}`).set(authed(token)).send({ status: "Inapplicable", processIds: ["p1"] });
    expect(updated.body.data).toMatchObject({ status: "Inapplicable", processIds: ["p1"] });

    const archived = await request(app).post(`/v1/work-units/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  it("rejects a site from another organization and enforces tenant scoping", async () => {
    const a = await makeTenant("wu2", "WU2");
    const b = await makeTenant("wu3", "WU3");
    const bSite = await makeSite(b.orgId, "WU3");

    // A cannot attach B's site.
    expect((await request(app).post("/v1/work-units").set(authed(a.token)).send({ name: "X", siteId: bSite })).status).toBe(400);

    const aWu = await request(app).post("/v1/work-units").set(authed(a.token)).send({ name: "A unit" });
    expect(aWu.status).toBe(201);
    // B cannot see A's work units.
    expect((await request(app).get("/v1/work-units").set(authed(b.token))).body.data).toHaveLength(0);
    // B cannot update A's work unit.
    expect((await request(app).put(`/v1/work-units/${aWu.body.data.id}`).set(authed(b.token)).send({ name: "hax" })).status).toBe(404);
  });

  it("enforces action grants and validates status", async () => {
    const noGrant = await makeTenant("wu4", "WU4", []);
    expect((await request(app).get("/v1/work-units").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("wu5", "WU5", [ACTIONS.WORKUNIT_READ]);
    expect((await request(app).get("/v1/work-units").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/work-units").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
    const full = await makeTenant("wu6", "WU6");
    expect((await request(app).post("/v1/work-units").set(authed(full.token)).send({ name: "x", status: "Bogus" })).status).toBe(400);
  });
});
