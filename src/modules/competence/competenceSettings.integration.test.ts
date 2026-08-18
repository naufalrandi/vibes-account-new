import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeOrg(username: string, code: string, actions: string[]): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  await User.create({
    orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

/**
 * OD `compSettings` (index.html:13378) — {requireMethod, allowActivateMissing,
 * requireEvidenceMandatory, allowOverride, defaultReassess}. §2.11 3-C /
 * P1 (task item 5, 2026-08-18 gap analysis): previously unported entirely (no
 * model/route/FE type) — BE hard-coded a stricter, non-configurable subset.
 */
describe("competence settings singleton", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("GET returns OD's defaults when no row exists yet", async () => {
    const { token } = await makeOrg("cs1", "CS1", [ACTIONS.COMPETENCE_READ]);
    const res = await request(app).get("/v1/competence/settings").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      requireMethod: true, allowActivateMissing: false, requireEvidenceMandatory: false,
      allowOverride: true, defaultReassess: 12,
    });
  });

  it("PUT persists a partial update, merged onto defaults, org-scoped", async () => {
    const a = await makeOrg("cs2", "CS2", [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE]);
    const put = await request(app).put("/v1/competence/settings").set(authed(a.token))
      .send({ allowActivateMissing: true, defaultReassess: 24 });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ allowActivateMissing: true, defaultReassess: 24, requireMethod: true });

    // Persisted — a second GET (same org) sees it.
    const get = await request(app).get("/v1/competence/settings").set(authed(a.token));
    expect(get.body.data.allowActivateMissing).toBe(true);
    expect(get.body.data.defaultReassess).toBe(24);

    // A different org is unaffected (per-org singleton, not global).
    const b = await makeOrg("cs3", "CS3", [ACTIONS.COMPETENCE_READ]);
    const getB = await request(app).get("/v1/competence/settings").set(authed(b.token));
    expect(getB.body.data).toEqual({
      requireMethod: true, allowActivateMissing: false, requireEvidenceMandatory: false,
      allowOverride: true, defaultReassess: 12,
    });
  });

  it("rejects a non-positive-integer defaultReassess", async () => {
    const { token } = await makeOrg("cs4", "CS4", [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE]);
    expect((await request(app).put("/v1/competence/settings").set(authed(token)).send({ defaultReassess: 0 })).status).toBe(400);
    expect((await request(app).put("/v1/competence/settings").set(authed(token)).send({ defaultReassess: "Annually" })).status).toBe(400);
  });

  it("gates read/write on COMPETENCE_READ/COMPETENCE_MANAGE", async () => {
    const noGrant = await makeOrg("cs5", "CS5", []);
    expect((await request(app).get("/v1/competence/settings").set(authed(noGrant.token))).status).toBe(403);
    const readOnly = await makeOrg("cs6", "CS6", [ACTIONS.COMPETENCE_READ]);
    expect((await request(app).get("/v1/competence/settings").set(authed(readOnly.token))).status).toBe(200);
    expect((await request(app).put("/v1/competence/settings").set(authed(readOnly.token)).send({ allowOverride: false })).status).toBe(403);
  });

  it("defaultReassess flows into an assessment's computed valid-until date", async () => {
    const { token } = await makeOrg("cs7", "CS7", [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE]);
    await request(app).put("/v1/competence/settings").set(authed(token)).send({ defaultReassess: 6 });

    const role = await request(app).post("/v1/competence/roles").set(authed(token))
      .send({ name: "QA Engineer", requirements: [] });
    expect(role.status).toBe(201);
    const assign = await request(app).post("/v1/competence/assignments").set(authed(token))
      .send({ roleId: role.body.data.id, personId: "person-1" });
    expect(assign.status).toBe(201);

    const assessment = await request(app).post("/v1/competence/assessments").set(authed(token))
      .send({ assignmentId: assign.body.data.id, date: "2026-01-01", requirements: [] });
    expect(assessment.status).toBe(201);
    // Role has no explicit reviewFreq, so the org's defaultReassess (6 months) applies.
    expect(assessment.body.data.validUntil).toBe("2026-07-01");
  });
});
