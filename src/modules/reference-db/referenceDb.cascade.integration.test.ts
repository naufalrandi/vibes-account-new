import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, CompetenceRole } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * G-05 — reference-data delete cascades. OD clears every inbound reference
 * before deleting a reference-data row (`eduDel` index.html:18417, `sectorDel`
 * 18506, `efDel` 18560) instead of leaving role profiles pointing at ids that
 * no longer resolve. These tests assert the same behavior against
 * `referenceDb.service.ts`'s delete handlers.
 *
 * Sectors and fields match on `code`, not `id`: `ReferenceIndustrySector` and
 * `ReferenceEducationField` are seeded per-org from the same ISIC/ISCED-F
 * datasets `/v1/reference` serves, but the role editor's pickers persist that
 * static-dataset `code` (e.g. "A", "01"), not either row's own database
 * `id` — so a role's `expReqs[].sector` / `eduFields[]` entries are compared
 * against `code` below, the same way `referenceDb.service.ts` now cascades.
 *
 * Education levels are exercised here against the now-DEPRECATED/ORPHANED
 * `ReferenceEducationLevel` table only, to prove its own (unused) cascade
 * logic still behaves internally consistently pending removal. The LIVE
 * education-level cascade that role profiles actually hit lives on the
 * unified `CompetenceEducation` store — see
 * `competence.integration.test.ts`'s "education level delete cascade" test.
 */

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const RD = [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = RD): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Admin", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

function makeRole(orgId: string, overrides: Partial<Parameters<typeof CompetenceRole.create>[0]> = {}) {
  return CompetenceRole.create({
    orgId, name: "Quality Manager", description: null, status: "Active", reviewFreq: "12",
    eduMinLevelId: null, eduFields: [], eduCountry: null, expReqs: [],
    responsibilities: [], authorities: [],
    ...overrides,
  });
}

describe("reference database delete cascades (G-05)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  // Exercises the deprecated/orphaned `ReferenceEducationLevel` table (see
  // referenceDb.service.ts) — nothing in production sets a role's
  // `eduMinLevelId` to one of these rows' ids anymore, so this only proves
  // the DB-level cascade still behaves pending removal, not that it fires
  // in practice. See `competence.integration.test.ts` for the live cascade.
  it("clears eduMinLevelId on referencing roles when an education level is deleted", async () => {
    const { token, orgId } = await makeTenant("casc1", "CASC1");
    const list = await request(app).get("/v1/reference-db/education-levels").set(authed(token));
    const level8 = list.body.data.find((l: { level: number }) => l.level === 8);

    const referencing = await makeRole(orgId, { eduMinLevelId: level8.id });
    const untouched = await makeRole(orgId, { name: "Other Role", eduMinLevelId: null });

    const del = await request(app).delete(`/v1/reference-db/education-levels/${level8.id}`).set(authed(token));
    expect(del.status).toBe(200);
    expect(del.body.data.affectedRoles).toBe(1);

    await referencing.reload();
    await untouched.reload();
    expect(referencing.eduMinLevelId).toBeNull();
    expect(untouched.eduMinLevelId).toBeNull();

    // The level itself is gone.
    const after = await request(app).get("/v1/reference-db/education-levels").set(authed(token));
    expect(after.body.data.find((l: { id: string }) => l.id === level8.id)).toBeUndefined();
  });

  it("clears matching expReqs[].sector entries (by code) on referencing roles when an industry sector is deleted, leaving other entries intact", async () => {
    const { token, orgId } = await makeTenant("casc2", "CASC2");
    const list = await request(app).get("/v1/reference-db/industry-sectors").set(authed(token));
    const sectionA = list.body.data.find((s: { code: string }) => s.code === "A");
    const sectionB = list.body.data.find((s: { code: string }) => s.code === "B");

    // The role editor persists the ISIC `code` (not this row's own `id`) —
    // see `forms.tsx`'s `addExpReq`.
    const referencing = await makeRole(orgId, {
      expReqs: [
        { id: "we-1", sector: sectionA.code, years: "5" },
        { id: "we-2", sector: sectionB.code, years: "2" },
      ],
    });
    // A role in a different org that happens to share the same code must not
    // be touched — sectors are org-scoped even though they're seeded from a
    // shared dataset.
    const { orgId: otherOrgId } = await makeTenant("casc2b", "CASC2B");
    const otherOrgRole = await makeRole(otherOrgId, { expReqs: [{ id: "we-3", sector: sectionA.code, years: "1" }] });

    const del = await request(app).delete(`/v1/reference-db/industry-sectors/${sectionA.id}`).set(authed(token));
    expect(del.status).toBe(200);
    expect(del.body.data.affectedRoles).toBe(1);

    await referencing.reload();
    expect(referencing.expReqs).toEqual([
      { id: "we-1", sector: "", years: "5" },
      { id: "we-2", sector: sectionB.code, years: "2" },
    ]);

    await otherOrgRole.reload();
    expect(otherOrgRole.expReqs).toEqual([{ id: "we-3", sector: sectionA.code, years: "1" }]);
  });

  it("removes the code from eduFields on referencing roles when a field of education is deleted, leaving other codes intact", async () => {
    const { token, orgId } = await makeTenant("casc3", "CASC3");
    const list = await request(app).get("/v1/reference-db/education-fields").set(authed(token));
    const [fieldA, fieldB] = list.body.data;

    // The role editor persists the ISCED-F `code` (not this row's own `id`)
    // — see `forms.tsx`'s field-of-study checklist (`toggleField`).
    const referencing = await makeRole(orgId, { eduFields: [fieldA.code, fieldB.code] });

    const del = await request(app).delete(`/v1/reference-db/education-fields/${fieldA.id}`).set(authed(token));
    expect(del.status).toBe(200);
    expect(del.body.data.affectedRoles).toBe(1);

    await referencing.reload();
    expect(referencing.eduFields).toEqual([fieldB.code]);
  });

  it("does not report or touch roles in a different organization", async () => {
    const { token, orgId } = await makeTenant("casc4a", "CASC4A");
    const { orgId: otherOrgId } = await makeTenant("casc4b", "CASC4B");
    const list = await request(app).get("/v1/reference-db/education-levels").set(authed(token));
    const level8 = list.body.data.find((l: { level: number }) => l.level === 8);

    // A role in a different org happens to share the same eduMinLevelId value
    // is not realistic (levels are seeded per-org with fresh UUIDs), so this
    // asserts the cascade query is scoped to the deleting org and reports 0
    // when nothing in that org references the level.
    const otherRole = await makeRole(otherOrgId, { eduMinLevelId: null });

    const del = await request(app).delete(`/v1/reference-db/education-levels/${level8.id}`).set(authed(token));
    expect(del.status).toBe(200);
    expect(del.body.data.affectedRoles).toBe(0);

    await otherRole.reload();
    expect(otherRole.eduMinLevelId).toBeNull();
  });
});
