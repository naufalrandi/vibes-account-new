import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, ApprovalPoolMember } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { RISK_STATUSES } from "./risk.service";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(
  username: string,
  code: string,
  actions = MS,
  withTM = false
): Promise<{ token: string; orgId: string; userId: string }> {
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
    fullName: "Test User",
    username,
    email: `${username}@x.io`,
    passwordHash: await hashPassword("ChangeMe123"),
    status: "Active",
    position: null,
    workUnit: null,
    lastLogin: null,
    activationToken: null,
    resetToken: null,
    resetExpires: null,
    personnelType: withTM ? "Top Management" : "Staff",
  });
  // Deterministic TM routing (risk.service.ts `hasTopManagement`) reads the
  // real Approvals-pool "isTM" flag (`ApprovalPoolMember`, the same one the
  // Approvals module itself uses) — not `personnelType`, which is a free-form
  // HR employment category with no "Top Management" value in its vocabulary.
  if (withTM) {
    await ApprovalPoolMember.create({ orgId: org.id, userId: user.id, isMST: false, mstPriority: "required", isTM: true, tmFinal: true });
  }
  const role = await Role.create({
    name: `R-${username}`,
    tierScope: "Tenant",
    orgId: org.id,
    isSuperAdmin: false,
    status: true,
  });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id, userId: user.id };
}

describe("Tenant Risk Register (/v1/risks)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a risk with auto-derived title and RISK-0001 code", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const res = await request(app)
      .post("/v1/risks")
      .set(authed(token))
      .send({
        description: "Unauthorized access to production database due to weak passwords and missing MFA",
        category: "Information Security",
        source: "Interested Party",
        methodology: "quant",
        likelihood: 4,
        impact: 4,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("RISK-0001");
    expect(res.body.data.status).toBe("Unassigned");
    expect(res.body.data.level).toBe(16);
    expect(res.body.data.band).toBe("Critical");
    expect(res.body.data.title).toBe("Unauthorized access to production database due to weak passwords");
  });

  it("manages tenant risk configuration and appetite", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const getCfg = await request(app).get("/v1/risks/config").set(authed(token));
    expect(getCfg.status).toBe(200);
    expect(getCfg.body.data.riskMethod).toBe("basic");
    expect(getCfg.body.data.riskAppetite).toBe(9);

    const updateCfg = await request(app)
      .put("/v1/risks/config")
      .set(authed(token))
      .send({
        riskMethod: "quant",
        riskAppetite: 12,
      });
    expect(updateCfg.status).toBe(200);
    expect(updateCfg.body.data.riskMethod).toBe("quant");
    expect(updateCfg.body.data.riskAppetite).toBe(12);
  });

  it("runs the full 9-state RTP lifecycle with dual-track approval, verification, and closure", async () => {
    const { token } = await makeTenant("t1", "TEN1", MS, true);

    // 1. Create unassigned risk
    const createRes = await request(app)
      .post("/v1/risks")
      .set(authed(token))
      .send({
        title: "Server room overheating",
        description: "Server room air conditioning failure causing thermal shutdown",
        category: "Infrastructure",
        methodology: "basic",
      });
    const riskId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe("Unassigned");

    // 2. Assign owner -> Assigned
    const assignRes = await request(app)
      .post(`/v1/risks/${riskId}/assign`)
      .set(authed(token))
      .send({ owner: "IT Ops Lead" });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.data.status).toBe("Assigned");
    expect(assignRes.body.data.owner).toBe("IT Ops Lead");

    // 3. Generate RTP -> RTP Draft
    const rtpRes = await request(app).post(`/v1/risks/${riskId}/rtp/generate`).set(authed(token));
    expect(rtpRes.status).toBe(200);
    expect(rtpRes.body.data.status).toBe("RTP Draft");

    // 4. Add Action Plan
    const apRes = await request(app)
      .post(`/v1/risks/${riskId}/rtp/action-plans`)
      .set(authed(token))
      .send({
        title: "Install redundant HVAC unit and IoT temperature monitor",
        deadline: "2026-10-01",
        resources: [{ id: "r1", title: "HVAC Unit", budget: 15000000, currency: "IDR" }],
        pics: ["Facilities Lead"],
      });
    expect(apRes.status).toBe(201);
    const apId = apRes.body.data.rtp.actionPlans[0].id;
    expect(apId).toBeDefined();

    // 5. Propose RTP -> Pending Approval
    const propRes = await request(app).post(`/v1/risks/${riskId}/rtp/propose`).set(authed(token));
    expect(propRes.status).toBe(200);
    expect(propRes.body.data.status).toBe("Pending Approval");

    // 6. Reject returns to RTP Draft with reason
    const rejRes = await request(app)
      .post(`/v1/risks/${riskId}/rtp/reject`)
      .set(authed(token))
      .send({ reason: "Add temperature alert SMS notification" });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.data.status).toBe("RTP Draft");

    // 7. Re-propose -> Pending Approval
    await request(app).post(`/v1/risks/${riskId}/rtp/propose`).set(authed(token));

    // 8. MS Approval with TM user present -> Pending TM Approval
    const msRes = await request(app).post(`/v1/risks/${riskId}/rtp/approve-ms`).set(authed(token));
    expect(msRes.status).toBe(200);
    expect(msRes.body.data.status).toBe("Pending TM Approval");

    // 9. TM Approval -> In Treatment
    const tmRes = await request(app).post(`/v1/risks/${riskId}/rtp/approve-tm`).set(authed(token));
    expect(tmRes.status).toBe(200);
    expect(tmRes.body.data.status).toBe("In Treatment");

    // 10. Complete treatment blocked while action plan is unverified
    const earlyComplete = await request(app).post(`/v1/risks/${riskId}/rtp/complete`).set(authed(token));
    expect(earlyComplete.status).toBe(400);

    // 11. Verify Action Plan
    const verifyRes = await request(app)
      .post(`/v1/risks/${riskId}/rtp/action-plans/${apId}/verify`)
      .set(authed(token));
    expect(verifyRes.status).toBe(200);

    // 12. Complete Treatment -> Monitored
    const completeRes = await request(app).post(`/v1/risks/${riskId}/rtp/complete`).set(authed(token));
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe("Monitored");

    // 13. Archive from Monitored -> Archived
    const archiveRes = await request(app).post(`/v1/risks/${riskId}/archive`).set(authed(token));
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe("Archived");
  });

  // P-6.5: RISK_STATUSES (risk.service.ts) is the vocabulary an exhaustive
  // switch over RiskStatus would rely on. archiveRisk() writes "Archived"
  // (line ~484) and the updateRisk() status guard special-cased it with a
  // `&& next !== "Archived"` bypass + `as any` — proof the type could not
  // express a value the service demonstrably writes. Pin the full vocabulary,
  // "Archived" last (terminal), so RISK_STATUSES[0] ("Unassigned", the silent
  // create default) is unchanged.
  it("RISK_STATUSES lists every status the service can write, including terminal Archived", () => {
    expect(RISK_STATUSES).toEqual([
      "Unassigned",
      "Assigned",
      "RTP Draft",
      "Pending Approval",
      "Pending TM Approval",
      "In Treatment",
      "Assessed",
      "Treated",
      "Monitored",
      "Archived",
    ]);
    expect(RISK_STATUSES[0]).toBe("Unassigned");
  });

  // P-6.5: widening RISK_STATUSES to include "Archived" must not weaken
  // archiveRisk()'s own precondition (line ~478) that a risk can only be
  // archived from "Monitored". That check is independent of RISK_STATUSES
  // (it compares rec.status directly), but pin it here so a future edit to
  // either place cannot silently turn "Archived" into a freely-reachable
  // status via the archive endpoint.
  it("archiveRisk still rejects a risk that has not reached Monitored", async () => {
    const { token } = await makeTenant("t2", "TEN2");
    const createRes = await request(app)
      .post("/v1/risks")
      .set(authed(token))
      .send({
        description: "Vendor contract renewal missed due to manual tracking process",
        category: "Compliance",
        methodology: "basic",
      });
    const riskId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe("Unassigned");

    const archiveRes = await request(app).post(`/v1/risks/${riskId}/archive`).set(authed(token));
    expect(archiveRes.status).toBe(400);
    expect(archiveRes.body.error.code).toBe("RISK_NOT_MONITORED");

    const stillRes = await request(app).get(`/v1/risks/${riskId}`).set(authed(token));
    expect(stillRes.body.data.status).toBe("Unassigned");
  });

  // Fix round 1 (fresh implementer): widening RISK_STATUSES to include
  // "Archived" (P-6.5, above) made "Archived" pass updateRisk()'s status
  // membership check for the first time. Membership was never the same
  // thing as *reachability* — archiveRisk() (line ~477) is the only
  // legitimate door to "Archived", gated on "Monitored" and writing its
  // own "Risk archived from Monitored status" activity entry + distinct
  // "risk.archived" audit action. Without this guard, PUT /v1/risks/:id
  // could set status: "Archived" from any state, silently skipping that
  // precondition and that audit trail. Pin all three properties together:
  // (1) archiveRisk still succeeds from Monitored and writes its real
  // activity entry, (2) archiveRisk still rejects a non-Monitored risk
  // (already covered above, re-asserted here for locality), and (3) the
  // generic updater refuses "Archived" from every state, Monitored
  // included — the case that would otherwise have been silently permitted
  // through the wrong door.
  it("PUT /v1/risks/:id cannot reach Archived from any state; only POST /:id/archive can, and only from Monitored", async () => {
    const { token } = await makeTenant("t3", "TEN3", MS, true);

    const createRes = await request(app)
      .post("/v1/risks")
      .set(authed(token))
      .send({
        description: "Contractor badge access not revoked after offboarding",
        category: "Physical Security",
        methodology: "basic",
      });
    const riskId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe("Unassigned");

    // Property 3a: from Unassigned, the generic updater refuses.
    const fromUnassigned = await request(app)
      .put(`/v1/risks/${riskId}`)
      .set(authed(token))
      .send({ status: "Archived" });
    expect(fromUnassigned.status).toBe(400);
    expect(fromUnassigned.body.error.code).toBe("RISK_STATUS_REQUIRES_DEDICATED_ENDPOINT");

    const stillUnassigned = await request(app).get(`/v1/risks/${riskId}`).set(authed(token));
    expect(stillUnassigned.body.data.status).toBe("Unassigned");

    // Property 2: archiveRisk itself still rejects a non-Monitored risk.
    const archiveTooEarly = await request(app).post(`/v1/risks/${riskId}/archive`).set(authed(token));
    expect(archiveTooEarly.status).toBe(400);
    expect(archiveTooEarly.body.error.code).toBe("RISK_NOT_MONITORED");

    // Walk the risk to Monitored via the real RTP lifecycle, so property 3
    // can be checked from the one state where archiving is legitimate.
    await request(app).post(`/v1/risks/${riskId}/assign`).set(authed(token)).send({ owner: "Facilities Lead" });
    await request(app).post(`/v1/risks/${riskId}/rtp/generate`).set(authed(token));
    const apRes = await request(app)
      .post(`/v1/risks/${riskId}/rtp/action-plans`)
      .set(authed(token))
      .send({
        title: "Automate badge deactivation on offboarding",
        deadline: "2026-11-01",
        resources: [{ id: "r1", title: "Access system integration", budget: 5000000, currency: "IDR" }],
        pics: ["Facilities Lead"],
      });
    const apId = apRes.body.data.rtp.actionPlans[0].id;
    await request(app).post(`/v1/risks/${riskId}/rtp/propose`).set(authed(token));
    await request(app).post(`/v1/risks/${riskId}/rtp/approve-ms`).set(authed(token));
    await request(app).post(`/v1/risks/${riskId}/rtp/approve-tm`).set(authed(token));
    await request(app).post(`/v1/risks/${riskId}/rtp/action-plans/${apId}/verify`).set(authed(token));
    const completeRes = await request(app).post(`/v1/risks/${riskId}/rtp/complete`).set(authed(token));
    expect(completeRes.body.data.status).toBe("Monitored");

    // Property 3b (the one most likely to be skipped): even from
    // Monitored, where the outcome would otherwise be "permitted anyway",
    // the generic updater still refuses — it must not be a second door.
    const fromMonitored = await request(app)
      .put(`/v1/risks/${riskId}`)
      .set(authed(token))
      .send({ status: "Archived" });
    expect(fromMonitored.status).toBe(400);
    expect(fromMonitored.body.error.code).toBe("RISK_STATUS_REQUIRES_DEDICATED_ENDPOINT");

    const stillMonitored = await request(app).get(`/v1/risks/${riskId}`).set(authed(token));
    expect(stillMonitored.body.data.status).toBe("Monitored");

    // Property 1: the real archive endpoint still succeeds from Monitored,
    // and writes archiveRisk()'s own distinct activity entry — proof this
    // guard didn't also break the legitimate path, and that reaching
    // Archived through the correct door still produces the correct audit
    // trail (unlike a hypothetical bypass through updateRisk(), which
    // would have written updateRisk()'s generic "Risk attributes updated"
    // entry instead).
    const archiveRes = await request(app).post(`/v1/risks/${riskId}/archive`).set(authed(token));
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe("Archived");
    const activity = archiveRes.body.data.activity as Array<{ action: string; summary: string }>;
    expect(activity[0].action).toBe("Archived");
    expect(activity[0].summary).toBe("Risk archived from Monitored status");
  });

  // OD `riskHasTM()` (app.html:14012) — deterministic TM routing keys off
  // whether the org's Approvals pool has ANY isTM member, read from the same
  // `ApprovalPoolMember` flag the Approvals module itself uses (not
  // `personnelType`, which never carries a "Top Management" value in real
  // data — see the `withTM` setup in `makeTenant` above). With no TM member
  // configured, MS approval goes straight to "In Treatment" (OD's
  // `rtpApproveMS` else-branch), skipping the TM gate entirely.
  it("MS approval with no Top Management member configured goes straight to In Treatment", async () => {
    const { token } = await makeTenant("t4", "TEN4", MS, false);

    const createRes = await request(app)
      .post("/v1/risks")
      .set(authed(token))
      .send({
        description: "Unpatched CVE on the public-facing API gateway",
        category: "Information Security",
        methodology: "basic",
      });
    const riskId = createRes.body.data.id;

    await request(app).post(`/v1/risks/${riskId}/assign`).set(authed(token)).send({ owner: "AppSec Lead" });
    await request(app).post(`/v1/risks/${riskId}/rtp/generate`).set(authed(token));
    await request(app)
      .post(`/v1/risks/${riskId}/rtp/action-plans`)
      .set(authed(token))
      .send({ title: "Patch and redeploy the gateway", deadline: "2026-09-15", pics: ["AppSec Lead"] });
    await request(app).post(`/v1/risks/${riskId}/rtp/propose`).set(authed(token));

    const msRes = await request(app).post(`/v1/risks/${riskId}/rtp/approve-ms`).set(authed(token));
    expect(msRes.status).toBe(200);
    expect(msRes.body.data.status).toBe("In Treatment");
    expect(msRes.body.data.rtp.approvedBy).toBeTruthy();
  });
});
