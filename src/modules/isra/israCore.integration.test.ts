import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { IsraThreatLibrary, IsraVulnLibrary, IsraAnnexAControl } from "../../db/models/israLibrary.models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

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
  await IsraAnnexAControl.findOrCreate({
    where: { ref: "A.8.24" },
    defaults: { ref: "A.8.24", name: "Use of cryptography", category: "Technological", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  });
  await IsraAnnexAControl.findOrCreate({
    where: { ref: "A.5.1" },
    defaults: { ref: "A.5.1", name: "Policies for information security", category: "Organizational", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  });
  await IsraAnnexAControl.findOrCreate({
    where: { ref: "A.8.7" },
    defaults: { ref: "A.8.7", name: "Protection against malware", category: "Technological", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
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

describe("ISRA Core: Asset Map, Scenarios, Method C Scoring & SoA (F-3 to F-6)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("builds an asset mapping tree with primary, process usage, secondary, threat, and vuln", async () => {
    const { token } = await makeTenant("isra_user1", "ORG_ISRA_1");

    // 1. Create primary asset map root
    const mapRes = await request(app)
      .post("/v1/isra/asset-maps")
      .set(authed(token))
      .send({ primaryAssetRef: "PAL-001", primaryAssetSource: "platform" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.data.id;

    // 2. Add process usage
    const usageRes = await request(app)
      .post(`/v1/isra/asset-maps/${mapId}/usages`)
      .set(authed(token))
      .send({ processRef: "PRC-001" });
    expect(usageRes.status).toBe(201);
    const usageId = usageRes.body.data.id;

    // 3. Add secondary asset attachment
    const secRes = await request(app)
      .post(`/v1/isra/asset-maps/usages/${usageId}/secondaries`)
      .set(authed(token))
      .send({ secondaryAssetRef: "SAL-001", secondaryAssetSource: "platform" });
    expect(secRes.status).toBe(201);
    const secId = secRes.body.data.id;

    // 4. Add threat
    const threatRes = await request(app)
      .post(`/v1/isra/asset-maps/secondaries/${secId}/threats`)
      .set(authed(token))
      .send({ threatId: "THR-001", isBaseline: false });
    expect(threatRes.status).toBe(201);
    const threatRowId = threatRes.body.data.id;

    // 5. Add vuln
    const vulnRes = await request(app)
      .post(`/v1/isra/asset-maps/threats/${threatRowId}/vulns`)
      .set(authed(token))
      .send({ vulnId: "VUL-001", isBaseline: false });
    expect(vulnRes.status).toBe(201);

    // 6. Query full tree
    const treeRes = await request(app).get("/v1/isra/asset-maps/tree").set(authed(token));
    expect(treeRes.status).toBe(200);
    expect(treeRes.body.data).toHaveLength(1);
    expect(treeRes.body.data[0].usages).toHaveLength(1);
    expect(treeRes.body.data[0].usages[0].secondaries).toHaveLength(1);
    expect(treeRes.body.data[0].usages[0].secondaries[0].threats).toHaveLength(1);
    expect(treeRes.body.data[0].usages[0].secondaries[0].threats[0].vulns).toHaveLength(1);
  });

  it("creates a scenario, rates 12 consequence areas with dominance floor, and calculates Method C Current Risk", async () => {
    const { token } = await makeTenant("isra_user2", "ORG_ISRA_2");

    // 1. Create scenario
    const scenRes = await request(app)
      .post("/v1/isra/scenarios")
      .set(authed(token))
      .send({
        primaryAssetRef: "PAL-001",
        secondaryAssetRef: "SAL-001",
        threatId: "THR-001",
        title: "Unauthorized database exfiltration",
        inherentL: 4,
        includedVulns: ["VUL-001"],
        potentialImpacts: [
          { area: "privacy", severity: 5, note: "PII breach affecting 10k users" },
          { area: "financial", severity: 2, note: "Minor direct cost" },
        ],
      });
    expect(scenRes.status).toBe(201);
    const scen = scenRes.body.data;
    expect(scen.code).toMatch(/^RSC-\d{4}$/);
    // Dominance floor: privacy has severity 5 >= 4, so overall impact must be >= 4
    expect(scen.overallImpact).toBeGreaterThanOrEqual(4);
    expect(scen.inherentScore).toBeGreaterThanOrEqual(16);

    // 2. Add an existing control mapped to Annex A
    const ctlRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/controls`)
      .set(authed(token))
      .send({
        title: "TLS 1.3 encryption and IP allowlisting",
        description: "Enforce network boundary isolation and encryption in transit",
        status: "Implemented and Effective",
        affects: "likelihood",
        annexRefs: ["A.8.20", "A.8.24"],
        maturity: { gov: 4, doc: 4, impl: 4, mon: 4, comp: 4 },
      });
    expect(ctlRes.status).toBe(201);

    // 3. Fetch scenario and verify Method C Current Risk auto-adopted
    const updatedScenRes = await request(app).get(`/v1/isra/scenarios/${scen.id}`).set(authed(token));
    expect(updatedScenRes.status).toBe(200);
    const updated = updatedScenRes.body.data;
    expect(updated.current).toBeDefined();
    expect(updated.current.confirmedL).toBeLessThanOrEqual(4);

    // 4. Save Treatment Decision
    const treatRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/treatment`)
      .set(authed(token))
      .send({
        option: "Modify",
        rationale: "Apply compensating controls to reduce residual risk",
      });
    expect(treatRes.status).toBe(200);
    expect(treatRes.body.data.option).toBe("Modify");

    // 5. Save RTP and approve
    const rtpRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/rtp`)
      .set(authed(token))
      .send({
        funding: [{ amount: 5000, remark: "WAF deployment" }],
        monitoring: "Weekly log audits",
        completionCriteria: "Zero public endpoints",
        actions: [
          {
            action: "Deploy AWS WAF rules",
            owners: ["DevOps Lead"],
            targetDate: "2026-09-30",
            status: "Planned",
            addedControlRefs: ["A.8.7"],
          },
        ],
      });
    expect(rtpRes.status).toBe(200);

    const approveRes = await request(app).post(`/v1/isra/scenarios/${scen.id}/rtp/approve`).set(authed(token));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe("Approved");

    // 6. Query derived SoA
    const soaRes = await request(app).get("/v1/isra/soa").set(authed(token));
    expect(soaRes.status).toBe(200);
    expect(Array.isArray(soaRes.body.data)).toBe(true);

    // Controls A.8.20 (from existing control) and A.8.7 (from RTP action) must be marked applicable!
    const a820 = soaRes.body.data.find((c: any) => c.ref === "A.8.20");
    const a87 = soaRes.body.data.find((c: any) => c.ref === "A.8.7");
    expect(a820?.applicable).toBe(true);
    expect(a87?.applicable).toBe(true);

    // 7. Update SoA justification
    const justRes = await request(app)
      .put("/v1/isra/soa/A.8.20/justification")
      .set(authed(token))
      .send({ justification: "Required for database boundary isolation" });
    expect(justRes.status).toBe(200);
    expect(justRes.body.data.justification).toBe("Required for database boundary isolation");
  });
});

describe("ISRA control catalog (SOF-351)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("lists the Annex A baseline and lets an org add a custom control, surfaced through the SoA", async () => {
    const { token } = await makeTenant("isra_ctlcat", "ORG_ISRA_CTLCAT");

    const before = await request(app).get("/v1/isra/soa").set(authed(token));
    expect(before.status).toBe(200);
    expect(before.body.data.every((c: any) => c.isCustom === false)).toBe(true);
    const baselineCount = before.body.data.length;

    const createRes = await request(app)
      .post("/v1/isra/soa/controls")
      .set(authed(token))
      .send({ name: "Vendor screening questionnaire", category: "Supplier Security", csf: "Identify", type: "Preventive", description: "Pre-onboarding vendor risk screen" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.ref).toBe("CUS-001");
    expect(createRes.body.data.isCustom).toBe(true);

    const after = await request(app).get("/v1/isra/soa").set(authed(token));
    expect(after.body.data.length).toBe(baselineCount + 1);
    const custom = after.body.data.find((c: any) => c.ref === "CUS-001");
    expect(custom).toMatchObject({ name: "Vendor screening questionnaire", category: "Supplier Security", csf: "Identify", type: "Preventive", isCustom: true });
  });

  it("rejects a custom control without a name", async () => {
    const { token } = await makeTenant("isra_ctlcat2", "ORG_ISRA_CTLCAT2");
    const res = await request(app).post("/v1/isra/soa/controls").set(authed(token)).send({ category: "Physical" });
    expect(res.status).toBe(400);
  });
});

describe("ISRA gap-register Wave Q, task Q3 fixes", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function createBareScenario(token: string) {
    const scenRes = await request(app)
      .post("/v1/isra/scenarios")
      .set(authed(token))
      .send({
        primaryAssetRef: "PAL-001",
        secondaryAssetRef: "SAL-001",
        threatId: "THR-001",
        title: "Unassessed scenario",
        inherentL: 4,
        includedVulns: ["VUL-001"],
        // Deliberately no potentialImpacts — this scenario is not yet assessed.
      });
    expect(scenRes.status).toBe(201);
    return scenRes.body.data;
  }

  // G-21 — an unrated scenario must not score as "Low".
  it("keeps overallImpact/inherentScore/inherentBand at the unassessed sentinel (0/0/'') instead of coercing to Low, on both create and list", async () => {
    const { token } = await makeTenant("isra_g21", "ORG_ISRA_G21");
    const scen = await createBareScenario(token);

    // Consumer 1: getScenarioById (returned directly from create, and from a fresh GET).
    expect(scen.overallImpact).toBe(0);
    expect(scen.inherentScore).toBe(0);
    expect(scen.inherentBand).toBe("");

    const getRes = await request(app).get(`/v1/isra/scenarios/${scen.id}`).set(authed(token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.overallImpact).toBe(0);
    expect(getRes.body.data.inherentScore).toBe(0);
    expect(getRes.body.data.inherentBand).toBe("");

    // Consumer 2: listScenarios (a separate code path with its own copy of the sentinel logic).
    const listRes = await request(app).get("/v1/isra/scenarios").set(authed(token));
    expect(listRes.status).toBe(200);
    const listed = listRes.body.data.find((s: { id: string }) => s.id === scen.id);
    expect(listed).toBeTruthy();
    expect(listed.overallImpact).toBe(0);
    expect(listed.inherentScore).toBe(0);
    expect(listed.inherentBand).toBe("");
  });

  // G-20 — an impact override without justification must be refused, not silently persisted.
  it("refuses to save an impact override without a justification, and accepts one with justification", async () => {
    const { token } = await makeTenant("isra_g20", "ORG_ISRA_G20");
    const scen = await createBareScenario(token);

    const noJust = await request(app)
      .put(`/v1/isra/scenarios/${scen.id}`)
      .set(authed(token))
      .send({ impactOverride: { severity: 4 } });
    expect(noJust.status).toBe(400);
    expect(noJust.body.error.code).toBe("OVERRIDE_JUSTIFICATION_REQUIRED");

    // Confirm nothing was persisted by the rejected save.
    const afterReject = await request(app).get(`/v1/isra/scenarios/${scen.id}`).set(authed(token));
    expect(afterReject.body.data.impactOverride).toBeFalsy();

    const withJust = await request(app)
      .put(`/v1/isra/scenarios/${scen.id}`)
      .set(authed(token))
      .send({ impactOverride: { severity: 4, justification: "Board-approved worst-case scenario for this asset class" } });
    expect(withJust.status).toBe(200);
    expect(withJust.body.data.impactOverride.severity).toBe(4);
    expect(withJust.body.data.impactOverride.justification).toBe("Board-approved worst-case scenario for this asset class");
    expect(withJust.body.data.overallImpact).toBe(4);
  });

  // G-92 — a treatment decision without a rationale must be refused.
  it("refuses to save a treatment decision without a rationale", async () => {
    const { token } = await makeTenant("isra_g92", "ORG_ISRA_G92");
    const scen = await createBareScenario(token);

    const noRationale = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/treatment`)
      .set(authed(token))
      .send({ option: "Modify" });
    expect(noRationale.status).toBe(400);
    expect(noRationale.body.error.code).toBe("TREATMENT_RATIONALE_REQUIRED");

    const withRationale = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/treatment`)
      .set(authed(token))
      .send({ option: "Modify", rationale: "Reduce likelihood via least-privilege access control." });
    expect(withRationale.status).toBe(200);
    expect(withRationale.body.data.rationale).toBe("Reduce likelihood via least-privilege access control.");
  });

  // G-91 — adequacy is computed against the org's appetite threshold and stored on save.
  it("computes and stores an adequacy verdict on the residual at save time", async () => {
    const { token } = await makeTenant("isra_g91", "ORG_ISRA_G91");
    const scen = await createBareScenario(token);

    // Set an explicit appetite threshold of 9 (also the service default, made explicit here).
    const appetiteRes = await request(app)
      .post("/v1/isra/support/appetite-log")
      .set(authed(token))
      .send({ threshold: 9, rationale: "Wave Q test threshold" });
    expect(appetiteRes.status).toBe(201);

    const withinRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/residual`)
      .set(authed(token))
      .send({ score: 6, basis: "verified", notes: "Within appetite" });
    expect(withinRes.status).toBe(200);
    expect(withinRes.body.data.adequacy).toBeTruthy();
    expect(withinRes.body.data.adequacy.threshold).toBe(9);
    expect(withinRes.body.data.adequacy.result).toBe("Within acceptance criteria");

    const aboveRes = await request(app)
      .post(`/v1/isra/scenarios/${scen.id}/residual`)
      .set(authed(token))
      .send({ score: 12, basis: "verified", notes: "Above appetite" });
    expect(aboveRes.status).toBe(200);
    expect(aboveRes.body.data.adequacy.result).toBe("Above acceptance criteria");
  });
});
