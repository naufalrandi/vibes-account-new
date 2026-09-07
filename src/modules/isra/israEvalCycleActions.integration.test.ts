import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { IsraThreatLibrary, IsraVulnLibrary } from "../../db/models/israLibrary.models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * F-302 — the two Risk Evaluation actions OD offers on the live cycle
 * (`isra2RiskEvalBody`'s actSec, js/core.js:14636-14653) and this port had no
 * endpoint for:
 *
 *   `isra2StartNextCycle` (js/core.js:14664) — "Confirm Current Controls".
 *     Cycle 1 renders the inherent risk only (OD's cycle-render matrix,
 *     js/core.js:15062), so this is the ONLY route from Cycle 1 into Cycle 2,
 *     where Current Controls / Current Risk / Risk Treatment live. Without it
 *     the matrix is a gate with no way past it.
 *   `isra2AcceptRisk` (js/core.js:14657) — "Accept risk". Within appetite no
 *     treatment is taken; the acceptance is stamped and the next re-evaluation
 *     scheduled a "within" period out.
 */
const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

const ADMIN_ACTIONS = [
  ACTIONS.ISRA_LIBRARY_READ,
  ACTIONS.ISRA_LIBRARY_MANAGE,
  ACTIONS.ISRA_LIBRARY_ADMIN,
  ACTIONS.ISRA_ORG_CONTROL_READ,
  ACTIONS.ISRA_ORG_CONTROL_MANAGE,
];

async function makeTenant(username: string, code: string): Promise<{ token: string; orgId: string }> {
  await IsraThreatLibrary.findOrCreate({
    where: { id: "THR-001" },
    defaults: { id: "THR-001", name: "Unauthorized Exfiltration", category: "Technical", description: "Data exfiltration" },
  });
  await IsraVulnLibrary.findOrCreate({
    where: { id: "VUL-001" },
    defaults: { id: "VUL-001", name: "Exposed DB replica", category: "Network", description: "Publicly accessible" },
  });

  const org = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "Tenant Assessor", username,
    email: `${username}@axia.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `Role-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, ADMIN_ACTIONS);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function createScenario(token: string) {
  const res = await request(app)
    .post("/v1/isra/scenarios")
    .set(authed(token))
    .send({
      primaryAssetRef: "PAL-001",
      secondaryAssetRef: "SAL-001",
      threatId: "THR-001",
      title: "F-302 cycle-action scenario",
      includedVulns: ["VUL-001"],
      inherentL: 4,
      // One rated area at 5 -> weighted severity 5, so inherent = 4 x 5 = 20.
      potentialImpacts: [{ area: "privacy", severity: 5, note: "PII exposure" }],
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function getScenario(token: string, id: string) {
  const res = await request(app).get(`/v1/isra/scenarios/${id}`).set(authed(token));
  expect(res.status).toBe(200);
  return res.body.data;
}

describe("F-302 — Risk Evaluation cycle actions", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("startNextCycle snapshots the inherent baseline and opens Cycle 2 (isra2StartNextCycle)", async () => {
    const { token } = await makeTenant("f302_next", "ORG_F302_NEXT");
    const scen = await createScenario(token);
    expect((await getScenario(token, scen.id)).evalCycle).toBe(1);

    const res = await request(app).post(`/v1/isra/scenarios/${scen.id}/cycle/next`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data.cycle).toBe(2);
    expect(res.body.data.within).toBe(false); // 20 > the default appetite of 9

    const got = await getScenario(token, scen.id);
    expect(got.evalCycle).toBe(2);
    expect(got.cycles).toHaveLength(1);
    expect(got.cycles[0].cycleNumber).toBe(1);
    expect(got.cycles[0].snapshot.risk.score).toBe(20);
    expect(got.cycles[0].snapshot.within).toBe(false);
    expect(got.reviewDue).toBeTruthy();
  });

  it("refuses to open a further cycle this way — Cycle 2+ advances by promoting its residual", async () => {
    const { token } = await makeTenant("f302_once", "ORG_F302_ONCE");
    const scen = await createScenario(token);

    expect((await request(app).post(`/v1/isra/scenarios/${scen.id}/cycle/next`).set(authed(token))).status).toBe(200);
    const again = await request(app).post(`/v1/isra/scenarios/${scen.id}/cycle/next`).set(authed(token));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("NOT_FIRST_CYCLE");
    expect((await getScenario(token, scen.id)).evalCycle).toBe(2);
  });

  it("acceptRisk stamps this cycle's score and reschedules the review (isra2AcceptRisk)", async () => {
    const { token } = await makeTenant("f302_accept", "ORG_F302_ACCEPT");
    const scen = await createScenario(token);
    expect((await getScenario(token, scen.id)).accepted).toBeNull();

    const res = await request(app).post(`/v1/isra/scenarios/${scen.id}/accept`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data.accepted.score).toBe(20);

    const got = await getScenario(token, scen.id);
    expect(got.accepted).not.toBeNull();
    expect(got.accepted.score).toBe(20);
    expect(got.accepted.by).toBeTruthy();
    expect(got.accepted.at).toBeTruthy();
    expect(got.reviewDue).toBeTruthy();
  });
});
