import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

const AGREEMENT_ACTIONS = [
  ACTIONS.AGREEMENT_READ,
  ACTIONS.AGREEMENT_CREATE,
  ACTIONS.AGREEMENT_UPDATE,
  ACTIONS.AGREEMENT_DELETE,
];

async function makeSoAdmin(actions: string[]): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Limited", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("agreement templates", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires the agreement.read grant", async () => {
    const { token } = await makeSoAdmin([]);
    const res = await request(app).get("/v1/partnership-agreements").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("serves the 28-variable catalog", async () => {
    const { token } = await makeSoAdmin(AGREEMENT_ACTIONS);
    const res = await request(app).get("/v1/partnership-agreements/variables").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(28);
    const groups = new Set(res.body.data.map((v: { group: string }) => v.group));
    expect(groups.size).toBe(6);
    expect(res.body.data[0]).toMatchObject({ key: expect.any(String), group: expect.any(String), example: expect.any(String) });
  });

  it("creates a template with an auto code and lists it", async () => {
    const { token } = await makeSoAdmin(AGREEMENT_ACTIONS);
    const res = await request(app).post("/v1/partnership-agreements").set(authed(token))
      .send({ name: "Reseller", blocks: [{ id: "b1", type: "heading", text: "TITLE" }] });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^AGT-\d+$/);
    expect(res.body.data.status).toBe("Draft");
    const list = await request(app).get("/v1/partnership-agreements").set(authed(token));
    expect(list.body.data).toHaveLength(1);
  });

  it("duplicates a template into a fresh Draft copy", async () => {
    const { token } = await makeSoAdmin(AGREEMENT_ACTIONS);
    const created = await request(app).post("/v1/partnership-agreements").set(authed(token))
      .send({ name: "Base", status: "Active", blocks: [{ id: "b1", type: "heading", text: "X" }] });
    const dup = await request(app).post(`/v1/partnership-agreements/${created.body.data.id}/duplicate`).set(authed(token));
    expect(dup.status).toBe(201);
    expect(dup.body.data.status).toBe("Draft");
    expect(dup.body.data.name).toContain("Copy");
    expect(dup.body.data.code).not.toBe(created.body.data.code);
  });

  it("blocks editing an archived template (409)", async () => {
    const { token } = await makeSoAdmin(AGREEMENT_ACTIONS);
    const created = await request(app).post("/v1/partnership-agreements").set(authed(token)).send({ name: "Old" });
    await request(app).put(`/v1/partnership-agreements/${created.body.data.id}`).set(authed(token)).send({ status: "Archived" });
    const res = await request(app).put(`/v1/partnership-agreements/${created.body.data.id}`).set(authed(token))
      .send({ name: "Renamed" });
    expect(res.status).toBe(409);
  });

  it("filters templates by status", async () => {
    const { token } = await makeSoAdmin(AGREEMENT_ACTIONS);
    await request(app).post("/v1/partnership-agreements").set(authed(token)).send({ name: "A", status: "Active" });
    await request(app).post("/v1/partnership-agreements").set(authed(token)).send({ name: "D", status: "Draft" });
    const res = await request(app).get("/v1/partnership-agreements?status=Active").set(authed(token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("A");
  });
});
