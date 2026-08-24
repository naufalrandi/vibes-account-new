import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, IsraScenarioAddedControl } from "../../db/models";
import { IsraThreatLibrary, IsraVulnLibrary, IsraAnnexAControl } from "../../db/models/israLibrary.models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { residualBasisText } from "./israScenario.service";

/**
 * ISRA gap-register Wave Q, task S3 — the `projected` tier of
 * `isra2SuggestResidual` (app.html:18643) was dead (nothing read or wrote
 * `IsraScenarioProjectedResidual`), so the engine silently fell through to
 * `current` with the wrong basis label. These tests exercise all four
 * priority tiers directly, the cap-at-current rule specifically (the
 * methodology claim: "treatment cannot raise the risk above where it
 * already sits"), the ported basis text, the exposed L/impact on the
 * residual payload, and `promoteResidual`'s full within/above-appetite
 * semantics.
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
  await IsraAnnexAControl.findOrCreate({
    where: { ref: "A.8.20" },
    defaults: { ref: "A.8.20", name: "Network security", category: "Technological", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  });

  const org = await Organization.create({
    name: code,
    code,
    type: "Tenant",
    status: "Active",
    parentOrgId: null,
    tenantId: null,
    email: null,
    phone: null,
    website: null,
    country: null,
    address: null,
  });
  const user = await User.create({
    orgId: org.id,
    tenantId: null,
    fullName: "Tenant Assessor",
    username,
    email: `${username}@axia.io`,
    passwordHash: await hashPassword("ChangeMe123"),
    status: "Active",
    position: null,
    workUnit: null,
    lastLogin: null,
    activationToken: null,
    resetToken: null,
    resetExpires: null,
  });
  const role = await Role.create({
    name: `Role-${username}`,
    tierScope: "Tenant",
    orgId: org.id,
    isSuperAdmin: false,
    status: true,
  });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, ADMIN_ACTIONS);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function createScenario(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/v1/isra/scenarios")
    .set(authed(token))
    .send({
      primaryAssetRef: "PAL-001",
      secondaryAssetRef: "SAL-001",
      threatId: "THR-001",
      title: "S3 suggestion-engine scenario",
      includedVulns: ["VUL-001"],
      inherentL: 4,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function getScenario(token: string, id: string) {
  const res = await request(app).get(`/v1/isra/scenarios/${id}`).set(authed(token));
  expect(res.status).toBe(200);
  return res.body.data;
}

describe("ISRA gap-register Wave Q, task S3 — residual suggestion engine (isra2SuggestResidual)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("tier 4 — inherent: falls back to inherentL x (overallImpact||3) when nothing else is available", async () => {
    const { token } = await makeTenant("s3_t4", "ORG_S3_T4");
    // No potentialImpacts, no controls -> overallImpact stays the G-21 zero
    // sentinel, and Current Risk's auto-adopted row is a zero placeholder,
    // not a meaningful confirmed value -> falls through past current to inherent.
    const scen = await createScenario(token, { inherentL: 4 });

    const got = await getScenario(token, scen.id);
    expect(got.suggestedResidual).toBeTruthy();
    expect(got.suggestedResidual.basis).toBe("inherent");
    expect(got.suggestedResidual.l).toBe(4);
    expect(got.suggestedResidual.impact).toBe(3); // oi.sev||3 fallback, per isra2SuggestResidual
    expect(got.suggestedResidual.score).toBe(12);
    expect(got.suggestedResidual.band).toBe("High");
    expect(got.suggestedResidual.basisText).toBe(residualBasisText("inherent"));
  });

  it("tier 3 — current: uses the confirmed Current Risk once the scenario is actually rated", async () => {
    const { token } = await makeTenant("s3_t3", "ORG_S3_T3");
    const scen = await createScenario(token, {
      inherentL: 4,
      potentialImpacts: [{ area: "privacy", severity: 5, note: "PII exposure" }],
    });
    // No existing controls -> Current == Inherent (4 x 5 = 20), but it IS a
    // meaningful confirmed value now, so tier 3 fires ahead of tier 4.
    const got = await getScenario(token, scen.id);
    expect(got.current.confirmedScore).toBe(20);
    expect(got.suggestedResidual.basis).toBe("current");
    expect(got.suggestedResidual.l).toBe(got.current.confirmedL);
    expect(got.suggestedResidual.impact).toBe(got.current.confirmedImpact);
    expect(got.suggestedResidual.score).toBe(20);
  });

  it("tier 2 — projected: a saved user-assessed Projected Residual wins over Current", async () => {
    const { token } = await makeTenant("s3_t2", "ORG_S3_T2");
    const scen = await createScenario(token, {
      inherentL: 3,
      potentialImpacts: [{ area: "financial", severity: 2, note: "minor" }],
    });
    // Current == inherent == 3 x 2 = 6 (no controls). Save a projected
    // residual well below that so the cap does not interfere.
    const projRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/projected-residual`)
      .set(authed(token))
      .send({ l: 1, impact: 2 });
    expect(projRes.status).toBe(200);
    expect(projRes.body.data.confirmedL).toBe(1);
    expect(projRes.body.data.confirmedImpact).toBe(2);
    expect(projRes.body.data.confirmedScore).toBe(2);
    // OD never runs Method C for this tier — no system suggestion is computed.
    expect(projRes.body.data.suggestedL).toBeNull();

    const got = await getScenario(token, scen.id);
    expect(got.current.confirmedScore).toBe(6);
    expect(got.suggestedResidual.basis).toBe("projected");
    expect(got.suggestedResidual.l).toBe(1);
    expect(got.suggestedResidual.impact).toBe(2);
    expect(got.suggestedResidual.score).toBe(2);
    expect(got.suggestedResidual.band).toBe("Low");
  });

  it("tier 1 — verified: Method C over controls verified this cycle wins over everything else", async () => {
    const { token } = await makeTenant("s3_t1", "ORG_S3_T1");
    const scen = await createScenario(token, {
      inherentL: 4,
      potentialImpacts: [{ area: "privacy", severity: 5, note: "PII exposure" }],
    });
    const ctlRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/controls`)
      .set(authed(token))
      .send({
        title: "MFA + least-privilege access",
        description: "Enforced least-privilege access control with MFA",
        status: "Implemented and Effective",
        affects: "likelihood",
        annexRefs: ["A.8.20"],
        maturity: { gov: 5, doc: 5, impl: 5, mon: 5, comp: 5 },
        verified: true,
        verifiedEffectiveness: 80,
      });
    expect(ctlRes.status).toBe(201);

    const got = await getScenario(token, scen.id);
    // Current pool also credits this same control (unverified-or-not is
    // irrelevant to Current), so Current == Verified numerically here — the
    // point of this test is which BASIS wins, not a numeric difference.
    expect(got.suggestedResidual.basis).toBe("verified");
    expect(got.suggestedResidual.l).toBe(3); // A.8.20 (dedL) drops L by 1: 4 -> 3
    expect(got.suggestedResidual.impact).toBe(5); // A.8.20 only deducts L (dedC:false)
    expect(got.suggestedResidual.score).toBe(15);
    expect(got.suggestedResidual.score).toBeLessThan(20); // some reduction happened vs. inherent 4x5
  });

  it("caps the suggestion at Current — treatment cannot raise the risk above where it already sits", async () => {
    const { token } = await makeTenant("s3_cap", "ORG_S3_CAP");
    const scen = await createScenario(token, {
      inherentL: 4,
      potentialImpacts: [{ area: "privacy", severity: 4, note: "dominance floor" }],
    });
    const got0 = await getScenario(token, scen.id);
    expect(got0.current.confirmedScore).toBe(16); // 4 x 4, no controls

    // Un-capped this would pick "projected" at 5x5=25, which EXCEEDS current
    // (16) -- assert the cap replaces it with "current" instead.
    const projRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/projected-residual`)
      .set(authed(token))
      .send({ l: 5, impact: 5 });
    expect(projRes.status).toBe(200);
    expect(projRes.body.data.confirmedScore).toBe(25);

    const got = await getScenario(token, scen.id);
    expect(got.suggestedResidual.basis).toBe("current"); // NOT "projected"
    expect(got.suggestedResidual.l).toBe(4);
    expect(got.suggestedResidual.impact).toBe(4);
    expect(got.suggestedResidual.score).toBe(16); // capped, not 25
    expect(got.suggestedResidual.band).toBe("Very High");
  });

  it("ports isra2ResidualBasisText verbatim, including the Method C parenthetical, storing the real & character", () => {
    expect(residualBasisText("verified")).toBe("implemented & verified controls (Method C)");
    expect(residualBasisText("projected")).toBe("the planned treatment controls in scope");
    expect(residualBasisText("current")).toBe("the current risk (no new treatment credited this cycle)");
    expect(residualBasisText("inherent")).toBe("the inherent risk (no controls credited yet)");
    expect(residualBasisText("verified")).not.toContain("&amp;");
    expect(residualBasisText("bogus")).toBe("the controls in scope");
    expect(residualBasisText(null)).toBe("the controls in scope");
  });

  it("exposes L and impact on the residual API payload (previously score/band/basis only)", async () => {
    const { token } = await makeTenant("s3_lc", "ORG_S3_LC");
    const scen = await createScenario(token);

    const saveRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/residual`)
      .set(authed(token))
      .send({ l: 2, impact: 3, basis: "verified", notes: "L x C now travels with the residual" });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.data.l).toBe(2);
    expect(saveRes.body.data.impact).toBe(3);
    expect(saveRes.body.data.score).toBe(6); // derived from L x impact, not a bare input

    const got = await getScenario(token, scen.id);
    expect(got.residual.l).toBe(2);
    expect(got.residual.impact).toBe(3);
  });
});

describe("ISRA gap-register Wave Q, task S3 — promoteResidual full semantics (isra2PromoteResidual)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function setUpTreatedScenario(token: string) {
    const scen = await createScenario(token, {
      inherentL: 4,
      potentialImpacts: [{ area: "privacy", severity: 5, note: "PII exposure" }],
    });
    const treatRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/treatment`)
      .set(authed(token))
      .send({ option: "Modify", rationale: "Reduce likelihood via access control." });
    expect(treatRes.status).toBe(200);

    const rtpRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/rtp`)
      .set(authed(token))
      .send({ monitoring: "Weekly review", completionCriteria: "Zero public endpoints", actions: [] });
    expect(rtpRes.status).toBe(200);
    await request(app).post(`/v1/isra/scenarios/${scen.id}/rtp/approve`).set(authed(token));

    await IsraScenarioAddedControl.create({ scenarioId: scen.id, annexRef: "A.8.20", relatedVulnNames: [], source: "test-fixture" });

    const projRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/projected-residual`)
      .set(authed(token))
      .send({ l: 2, impact: 2 });
    expect(projRes.status).toBe(200);

    return scen;
  }

  it("within appetite: promotes L/impact to Current, accepts, archives the RTP, clears added controls and the projected slot", async () => {
    const { token } = await makeTenant("s3_prom_ok", "ORG_S3_PROM_OK");
    const scen = await setUpTreatedScenario(token);

    const beforeReviewDue = (await getScenario(token, scen.id)).reviewDue;

    const saveRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/residual`)
      .set(authed(token))
      .send({ l: 1, impact: 2, basis: "verified" }); // score 2 <= default appetite 9
    expect(saveRes.status).toBe(200);

    const promoteRes = await request(app).post(`/v1/isra/scenarios/${scen.id}/residual/promote`).set(authed(token));
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.data.within).toBe(true);
    expect(promoteRes.body.data.cycle).toBe(2);

    const got = await getScenario(token, scen.id);
    expect(got.evalCycle).toBe(2);
    expect(got.current.confirmedL).toBe(1);
    expect(got.current.confirmedImpact).toBe(2);
    expect(got.current.confirmedScore).toBe(2);
    expect(got.current.confirmedBand).toBe("Low");
    expect(got.residual).toBeNull();
    expect(got.projectedResidual).toBeNull();
    expect(got.treatment.status).toBe("Accepted");
    expect(got.rtp).toBeNull(); // archived out of "current" (isCurrent flipped false)
    expect(got.addedControls).toHaveLength(0);
    expect(got.reviewDue).not.toBe(beforeReviewDue);
    expect(got.cycles).toHaveLength(1);
    expect(got.cycles[0].cycleNumber).toBe(1);
  });

  it("above appetite: leaves acceptance unset and keeps the RTP/added controls live for further treatment", async () => {
    const { token } = await makeTenant("s3_prom_bad", "ORG_S3_PROM_BAD");
    const scen = await setUpTreatedScenario(token);

    const saveRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/residual`)
      .set(authed(token))
      .send({ l: 4, impact: 4, basis: "current" }); // score 16 > default appetite 9
    expect(saveRes.status).toBe(200);

    const promoteRes = await request(app).post(`/v1/isra/scenarios/${scen.id}/residual/promote`).set(authed(token));
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.data.within).toBe(false);

    const got = await getScenario(token, scen.id);
    expect(got.current.confirmedScore).toBe(16);
    expect(got.residual).toBeNull();
    expect(got.projectedResidual).toBeNull(); // projected always clears, regardless of appetite
    expect(got.treatment.status).toBe("Active"); // NOT flipped to Accepted
    expect(got.rtp).not.toBeNull(); // stays current — further treatment needed
    expect(got.addedControls).toHaveLength(1); // NOT cleared
  });
});
