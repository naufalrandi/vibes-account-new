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
});
