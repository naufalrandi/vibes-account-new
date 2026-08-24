import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, CompetenceRole } from "../../db/models";
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
    // "Internal Auditing" collides with one of the 8 base-seeded Competence
    // Library skills (`BASE_SKILLS`, skillLibrary.ts) — use a name that can't
    // collide so the created row is unambiguously identifiable below. The
    // library is now globally seeded (290 rows), so assertions here check the
    // created/visible row itself rather than an exact global count.
    const skill = await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "SP Bespoke Hard Skill", type: "hard", methods: ["Written exam", "Practical assessment"] });
    expect(skill.status).toBe(201);
    expect(skill.body.data).toMatchObject({ name: "SP Bespoke Hard Skill", type: "hard", orgId: null });
    const skillsList = (await request(app).get("/v1/competence/skills").set(authed(sp.token))).body.data;
    const foundSkill = skillsList.find((s: { id: string }) => s.id === skill.body.data.id);
    expect(foundSkill).toMatchObject({ name: "SP Bespoke Hard Skill", type: "hard", orgId: null });
    // Invalid type rejected.
    expect((await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "X", type: "bogus" })).status).toBe(400);

    const edu = await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 6, label: "Bachelor's or equivalent" });
    expect(edu.status).toBe(201);
    // Duplicate level rejected.
    expect((await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 6, label: "dup" })).status).toBe(400);

    // "ISO 9001 Lead Auditor" collides with a seeded Training Catalog course
    // (`TRAINING_LIBRARY`) — use a bespoke name for the same reason as above.
    const tr = await request(app).post("/v1/competence/training").set(authed(sp.token)).send({ name: "SP Bespoke Training Course" });
    expect(tr.body.data).toMatchObject({ source: "SP", orgId: null });
  });

  it("tenants see global libraries + SP training and own their tenant training", async () => {
    const sp = await makeOrg("co-sp2", "COSP2", "ServiceOwner");
    // "Risk Assessment" collides with a base-seeded skill — see the note in
    // the previous test.
    const spSkill = (await request(app).post("/v1/competence/skills").set(authed(sp.token)).send({ name: "Test SP Global Skill", type: "hard" })).body.data;
    expect(spSkill.orgId).toBeNull();
    const spTraining = (await request(app).post("/v1/competence/training").set(authed(sp.token)).send({ name: "Risk Fundamentals" })).body.data;

    const a = await makeOrg("co-ta", "COTA", "Tenant");
    const b = await makeOrg("co-tb", "COTB", "Tenant");
    // Global skill + SP training are visible to tenants — checked by presence,
    // not exact list length, since the library now ships 290 seeded rows.
    const aSkillsInitial = (await request(app).get("/v1/competence/skills").set(authed(a.token))).body.data;
    expect(aSkillsInitial.find((s: { id: string }) => s.id === spSkill.id)).toMatchObject({ name: "Test SP Global Skill", orgId: null });
    const aTrainingInitial = (await request(app).get("/v1/competence/training").set(authed(a.token))).body.data;
    expect(aTrainingInitial.find((t: { id: string }) => t.id === spTraining.id)).toMatchObject({ name: "Risk Fundamentals", source: "SP" });

    // A tenant's own skill is org-scoped: A sees global + own, B only global;
    // B cannot mutate A's skill and no tenant can touch the global row.
    const ownSkill = (await request(app).post("/v1/competence/skills").set(authed(a.token)).send({ name: "Site SOP", type: "hard" })).body.data;
    expect(ownSkill.orgId).toBe(a.orgId);
    const aSkills = (await request(app).get("/v1/competence/skills").set(authed(a.token))).body.data;
    expect(aSkills.some((s: { id: string }) => s.id === spSkill.id)).toBe(true);
    expect(aSkills.some((s: { id: string }) => s.id === ownSkill.id)).toBe(true);
    const bSkills = (await request(app).get("/v1/competence/skills").set(authed(b.token))).body.data;
    expect(bSkills.some((s: { id: string }) => s.id === spSkill.id)).toBe(true);
    expect(bSkills.some((s: { id: string }) => s.id === ownSkill.id)).toBe(false);
    expect((await request(app).put(`/v1/competence/skills/${ownSkill.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).put(`/v1/competence/skills/${spSkill.id}`).set(authed(a.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete(`/v1/competence/skills/${spSkill.id}`).set(authed(a.token))).status).toBe(403);

    // The ISCED education ladder is SP-managed reference data — tenant writes are rejected.
    expect((await request(app).post("/v1/competence/education").set(authed(a.token)).send({ level: 6, label: "Bachelor's" })).status).toBe(403);

    // Tenant A creates its own training → source Tenant, org-scoped.
    const own = await request(app).post("/v1/competence/training").set(authed(a.token)).send({ name: "Internal SOP Training" });
    expect(own.body.data).toMatchObject({ source: "Tenant", orgId: a.orgId });
    // A sees SP + own; B sees only SP — not A's tenant course.
    const aTraining = (await request(app).get("/v1/competence/training").set(authed(a.token))).body.data;
    expect(aTraining.some((t: { id: string }) => t.id === spTraining.id)).toBe(true);
    expect(aTraining.some((t: { id: string }) => t.id === own.body.data.id)).toBe(true);
    const bTraining = (await request(app).get("/v1/competence/training").set(authed(b.token))).body.data;
    expect(bTraining.some((t: { id: string }) => t.id === spTraining.id)).toBe(true);
    expect(bTraining.some((t: { id: string }) => t.id === own.body.data.id)).toBe(false);
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

  it("updateEducation persists a changed ISCED level number and rejects a duplicate", async () => {
    // OD `eduSave` (app.html:34590) writes the ISCED number on
    // update, not just create — the level is editable on an existing row.
    const sp = await makeOrg("co-edu-upd", "COEDUUPD", "ServiceOwner");
    const a = (await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 3, label: "Upper secondary" })).body.data;
    await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 4, label: "Post-secondary non-tertiary" });

    const dup = await request(app).put(`/v1/competence/education/${a.id}`).set(authed(sp.token)).send({ level: 4 });
    expect(dup.status).toBe(400);

    const upd = await request(app).put(`/v1/competence/education/${a.id}`).set(authed(sp.token)).send({ level: 5, label: "Renamed" });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ level: 5, label: "Renamed" });
  });

  /**
   * G-05 (education levels) — the LIVE cascade. `CompetenceEducation` is the
   * store the Enterprise "Education Levels" page, the role editor's "Minimum
   * education (ISCED)" field, and the Competence Library all now share (OD
   * `db.compEdu`, `eduDel` index.html:18417). Unlike the org-scoped sector/
   * field cascades in `referenceDb.service.ts`, this table is global
   * (org_id NULL — matching OD's single shared store), so deleting a level
   * has to clear `eduMinLevelId` on every referencing role across every org,
   * exactly like OD's flat, unscoped `db.roles` sweep.
   */
  it("education level delete cascade clears eduMinLevelId on referencing roles across every org", async () => {
    const sp = await makeOrg("co-edu-del", "COEDUDEL", "ServiceOwner");
    const level = (await request(app).post("/v1/competence/education").set(authed(sp.token)).send({ level: 7, label: "Master's or equivalent" })).body.data;

    const tenantA = await makeOrg("co-edu-a", "COEDUA", "Tenant");
    const tenantB = await makeOrg("co-edu-b", "COEDUB", "Tenant");
    const roleFields = { description: null, status: "Active" as const, reviewFreq: "12", eduFields: [], eduCountry: null, expReqs: [], responsibilities: [], authorities: [] };
    const roleA = await CompetenceRole.create({ orgId: tenantA.orgId, name: "Role A", eduMinLevelId: level.id, ...roleFields });
    const roleB = await CompetenceRole.create({ orgId: tenantB.orgId, name: "Role B", eduMinLevelId: level.id, ...roleFields });
    const untouched = await CompetenceRole.create({ orgId: tenantA.orgId, name: "Other Role", eduMinLevelId: null, ...roleFields });

    const del = await request(app).delete(`/v1/competence/education/${level.id}`).set(authed(sp.token));
    expect(del.status).toBe(200);
    expect(del.body.data.affectedRoles).toBe(2);

    await roleA.reload();
    await roleB.reload();
    await untouched.reload();
    expect(roleA.eduMinLevelId).toBeNull();
    expect(roleB.eduMinLevelId).toBeNull();
    expect(untouched.eduMinLevelId).toBeNull();

    const after = await request(app).get("/v1/competence/education").set(authed(sp.token));
    expect(after.body.data.find((l: { id: string }) => l.id === level.id)).toBeUndefined();
  });
});
