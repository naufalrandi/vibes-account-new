import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, CompetenceSkill, CompetenceTraining } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CO = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];

async function makeTenant(username: string, code: string): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Assessor", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, CO);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("competence skill library + training catalog seed (G-03)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("seeds the global library on first read: 290 skills (174 hard, 116 soft) and 21 training courses", async () => {
    const { token } = await makeTenant("sl1", "SL1");
    const skills: { id: string; name: string; type: string; orgId: string | null; methods: string[]; description: string | null; topic: string }[] =
      (await request(app).get("/v1/competence/skills").set(authed(token))).body.data;
    expect(skills).toHaveLength(290);
    expect(skills.filter((s) => s.type === "hard")).toHaveLength(174);
    expect(skills.filter((s) => s.type === "soft")).toHaveLength(116);
    expect(skills.every((s) => s.orgId === null)).toBe(true);
    expect(skills.every((s) => s.description && s.description.length > 0)).toBe(true);
    expect(skills.every((s) => typeof s.topic === "string" && s.topic.length > 0)).toBe(true);

    // Base skill sk1 keeps its own methods, not the generic library default.
    const auditing = skills.find((s) => s.name === "Internal Auditing");
    expect(auditing).toMatchObject({ type: "hard", methods: ["Written exam", "Practical assessment"] });
    const stakeholder = skills.find((s) => s.name === "Stakeholder Management");
    expect(stakeholder).toMatchObject({ type: "soft", methods: ["Interview"] });
    // The colliding library entry ("Stakeholder management", lowercase m) is not duplicated.
    expect(skills.filter((s) => s.name.toLowerCase() === "stakeholder management")).toHaveLength(1);

    const training: { name: string; source: string; orgId: string | null; description: string | null }[] =
      (await request(app).get("/v1/competence/training").set(authed(token))).body.data;
    expect(training).toHaveLength(21);
    expect(training.filter((t) => t.source === "SP")).toHaveLength(19);
    expect(training.filter((t) => t.source === "Tenant")).toHaveLength(2);
    expect(training.every((t) => t.orgId === null)).toBe(true);
    expect(training.every((t) => t.description && t.description.length > 0)).toBe(true);
  });

  it("is idempotent: reading twice does not duplicate any global row", async () => {
    const { token } = await makeTenant("sl2", "SL2");
    await request(app).get("/v1/competence/skills").set(authed(token));
    await request(app).get("/v1/competence/training").set(authed(token));
    const skillCount1 = await CompetenceSkill.count({ where: { orgId: null } });
    const trainingCount1 = await CompetenceTraining.count({ where: { orgId: null } });

    await request(app).get("/v1/competence/skills").set(authed(token));
    await request(app).get("/v1/competence/training").set(authed(token));
    const skillCount2 = await CompetenceSkill.count({ where: { orgId: null } });
    const trainingCount2 = await CompetenceTraining.count({ where: { orgId: null } });

    expect(skillCount2).toBe(skillCount1);
    expect(trainingCount2).toBe(trainingCount1);
    expect(skillCount1).toBe(290);
    expect(trainingCount1).toBe(21);
  });

  it("backfills a description on a global skill another seeder created first, without duplicating it", async () => {
    const { token } = await makeTenant("sl3", "SL3");
    // The exam-bank seed (competence.instrument.service.ts `ensureInstrumentSeed`)
    // creates 15 global hard skills — several of which are also library/base
    // names (e.g. "Internal Auditing") — with description: null. It must run
    // first here to prove the two seeders don't fight over the same rows.
    await request(app).get("/v1/competence/instruments/exams").set(authed(token));
    const bankRow = await CompetenceSkill.findOne({ where: { orgId: null, name: "Internal Auditing" } });
    expect(bankRow?.description).toBeNull();

    const skills: { id: string; name: string; description: string | null }[] =
      (await request(app).get("/v1/competence/skills").set(authed(token))).body.data;
    expect(skills).toHaveLength(290); // still 290 — no duplicate "Internal Auditing" row
    expect(skills.filter((s) => s.name === "Internal Auditing")).toHaveLength(1);
    const backfilled = skills.find((s) => s.name === "Internal Auditing");
    expect(backfilled?.description).toBeTruthy(); // top-up backfilled the bank-seeded row's empty description
  });
});
