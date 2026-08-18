import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CO = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];

async function makeOrg(username: string, code: string, type: "ServiceOwner" | "Tenant", actions: string[] = CO): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("competence libraries", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("SP manages global skills, education and SP-training", async () => {
    const sp = await makeOrg("co-sp", "COSP", "ServiceOwner");
    const skill = await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "Internal Auditing", type: "hard", methods: ["Written exam", "Practical assessment"] });
    expect(skill.status).toBe(201);
    expect(skill.body.data).toMatchObject({ name: "Internal Auditing", type: "hard" });
    expect((await request(app).get("/v1/competence/skills").set(authed(sp.token))).body.data).toHaveLength(1);
    // Invalid type rejected.
    expect((await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "X", type: "bogus" })).status).toBe(400);

    const edu = await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 6, label: "Bachelor's or equivalent" });
    expect(edu.status).toBe(201);
    // Duplicate level rejected.
    expect((await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 6, label: "dup" })).status).toBe(400);

    const tr = await request(app).post("/v1/competence/training").set(authed(sp.token)).send({ name: "ISO 9001 Lead Auditor" });
    expect(tr.body.data).toMatchObject({ source: "SP", orgId: null });
  });

  it("tenants see global libraries + SP training and own their tenant training", async () => {
    const sp = await makeOrg("co-sp2", "COSP2", "ServiceOwner");
    const spSkill = (await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "Risk Assessment", type: "hard" })).body.data;
    expect(spSkill.orgId).toBeNull();
    await request(app).post("/v1/competence/training").set(authed(sp.token)).send({ name: "Risk Fundamentals" });

    const a = await makeOrg("co-ta", "COTA", "Tenant");
    const b = await makeOrg("co-tb", "COTB", "Tenant");
    // Global skill + SP training are visible to tenants.
    expect((await request(app).get("/v1/competence/skills").set(authed(a.token))).body.data).toHaveLength(1);
    expect((await request(app).get("/v1/competence/training").set(authed(a.token))).body.data).toHaveLength(1);

    // A tenant's own skill is org-scoped: A sees global + own (2), B only global (1);
    // B cannot mutate A's skill and no tenant can touch the global row.
    const ownSkill = (await request(app).post("/v1/competence/skills").set(authed(a.token)).send({ name: "Site SOP", type: "hard" })).body.data;
    expect(ownSkill.orgId).toBe(a.orgId);
    expect((await request(app).get("/v1/competence/skills").set(authed(a.token))).body.data).toHaveLength(2);
    expect((await request(app).get("/v1/competence/skills").set(authed(b.token))).body.data).toHaveLength(1);
    expect((await request(app).put(`/v1/competence/skills/${ownSkill.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).put(`/v1/competence/skills/${spSkill.id}`).set(authed(a.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete(`/v1/competence/skills/${spSkill.id}`).set(authed(a.token))).status).toBe(403);

    // The ISCED education ladder is SP-managed reference data — tenant writes are rejected.
    expect((await request(app).post("/v1/competence/education").set(authed(a.token)).send({ level: 6, label: "Bachelor's" })).status).toBe(403);

    // Tenant A creates its own training → source Tenant, org-scoped.
    const own = await request(app).post("/v1/competence/training").set(authed(a.token)).send({ name: "Internal SOP Training" });
    expect(own.body.data).toMatchObject({ source: "Tenant", orgId: a.orgId });
    // A sees SP + own (2); B sees only SP (1) — not A's tenant course.
    expect((await request(app).get("/v1/competence/training").set(authed(a.token))).body.data).toHaveLength(2);
    expect((await request(app).get("/v1/competence/training").set(authed(b.token))).body.data).toHaveLength(1);
    // B cannot edit A's training.
    expect((await request(app).put(`/v1/competence/training/${own.body.data.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);
  });

  it("enforces action grants", async () => {
    const noGrant = await makeOrg("co-n", "CON", "Tenant", []);
    expect((await request(app).get("/v1/competence/skills").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeOrg("co-r", "COR", "Tenant", [ACTIONS.COMPETENCE_READ]);
    expect((await request(app).get("/v1/competence/skills").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/competence/skills").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
  });
});
