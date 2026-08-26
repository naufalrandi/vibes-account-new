import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const DOA = [ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = DOA): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("DOA matrix (delegation of authority spend bands)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates, lists, updates and deletes an entry, scoped to the org", async () => {
    const { token } = await makeTenant("doa1", "DOA1");

    const created = await request(app).post("/v1/doa-matrix").set(authed(token))
      .send({ type: "Vehicle", max: 50000000, currency: "IDR", approver: "Line Manager", approverKind: "role", finance: false, quotes: true });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ type: "Vehicle", max: 50000000, currency: "IDR", approver: "Line Manager", approverKind: "role", quotes: true });
    const id = created.body.data.id;

    // Unlimited ceiling is represented as a null max.
    const unlimited = await request(app).post("/v1/doa-matrix").set(authed(token))
      .send({ type: "Electronics - Endpoint Devices", approver: "CFO", approverKind: "user", finance: true });
    expect(unlimited.status).toBe(201);
    expect(unlimited.body.data.max).toBeNull();

    const list = await request(app).get("/v1/doa-matrix").set(authed(token));
    expect(list.body.data).toHaveLength(2);

    const updated = await request(app).put(`/v1/doa-matrix/${id}`).set(authed(token)).send({ max: 75000000 });
    expect(updated.body.data.max).toBe(75000000);

    const del = await request(app).delete(`/v1/doa-matrix/${id}`).set(authed(token));
    expect(del.status).toBe(200);
    expect((await request(app).get("/v1/doa-matrix").set(authed(token))).body.data).toHaveLength(1);
  });

  it("rejects an invalid approverKind and enforces tenant scoping", async () => {
    const a = await makeTenant("doa2", "DOA2");
    const b = await makeTenant("doa3", "DOA3");

    const bad = await request(app).post("/v1/doa-matrix").set(authed(a.token))
      .send({ type: "Vehicle", approver: "Line Manager", approverKind: "department" });
    expect(bad.status).toBe(400);

    const ok = await request(app).post("/v1/doa-matrix").set(authed(a.token))
      .send({ type: "Vehicle", approver: "Line Manager", approverKind: "role" });
    expect(ok.status).toBe(201);

    expect((await request(app).get("/v1/doa-matrix").set(authed(b.token))).body.data).toHaveLength(0);

    const readonly = await makeTenant("doa4", "DOA4", [ACTIONS.APPROVAL_READ]);
    expect((await request(app).get("/v1/doa-matrix").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/doa-matrix").set(authed(readonly.token)).send({ type: "x", approver: "y" })).status).toBe(403);
  });
});
