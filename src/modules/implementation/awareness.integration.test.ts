import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Notification, Organization, Role, RoleAssignment, RoleTemplate, User } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions = MS): Promise<{ token: string; orgId: string; userId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "Tenant Administrator", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id, userId: user.id };
}

async function addMember(orgId: string, fullName: string, username: string, status = "Active"): Promise<User> {
  return User.create({ orgId, tenantId: null, fullName, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status, position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
}

/** A topic with one live material — passes the launch material gate. */
async function makeTopic(token: string, title = "Phishing awareness", withMaterial = true) {
  const res = await request(app).post("/v1/implementation/awareness-topics").set(authed(token)).send({
    title,
    data: withMaterial
      ? { category: "Security", materials: [{ title, fileName: "deck.pdf", version: "1.0", owner: "", addedAt: "2026-01-01" }] }
      : { category: "Security" },
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; code: string };
}

async function makeCampaign(token: string, data: Record<string, unknown>, title = "June IS Awareness") {
  const res = await request(app).post("/v1/implementation/awareness-campaigns").set(authed(token)).send({
    title, status: "Draft", data,
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; code: string; status: string; data: Record<string, unknown> };
}

interface AckRow { id: string; memberId: string; memberName: string; status: string; due: string; statement: string; ackDate: string; reminderDate: string; waiverReason: string }
interface EvalRow { id: string; memberId: string; result: string; method: string; followupRequired: boolean; followupActionId: string; trainingPlanId?: string }

describe("Awareness acknowledgment/evaluation stack", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  // --- Settings singleton (OD `awSettings`) ----------------------------------

  it("serves OD's default awareness settings and persists toggles", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const got = await request(app).get("/v1/implementation/awareness/settings").set(authed(token));
    expect(got.status).toBe(200);
    expect(got.body.data).toEqual({
      requireMaterial: true, allowLaunchNoMaterial: false, requireAck: true,
      requireEval: false, reminders: true, reminderFreq: "Once before due date",
    });

    const put = await request(app).put("/v1/implementation/awareness/settings").set(authed(token))
      .send({ requireEval: true, reminderFreq: "Daily after overdue", ignored: "x" });
    expect(put.status).toBe(200);
    expect(put.body.data.requireEval).toBe(true);
    expect(put.body.data.reminderFreq).toBe("Daily after overdue");

    const again = await request(app).get("/v1/implementation/awareness/settings").set(authed(token));
    expect(again.body.data.requireEval).toBe(true);
  });

  it("rejects an unknown reminder frequency", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const put = await request(app).put("/v1/implementation/awareness/settings").set(authed(token))
      .send({ reminderFreq: "Every full moon" });
    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe("INVALID_REMINDER_FREQ");
  });

  // --- Topic activation gate (settings-aware) --------------------------------

  it("keeps the material gate on topic activation, but releases it when requireMaterial is off", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const topic = await makeTopic(token, "No material yet", false);
    const blocked = await request(app).put(`/v1/implementation/awareness-topics/${topic.id}`).set(authed(token))
      .send({ status: "Active" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("MATERIAL_REQUIRED");

    await request(app).put("/v1/implementation/awareness/settings").set(authed(token)).send({ requireMaterial: false });
    const allowed = await request(app).put(`/v1/implementation/awareness-topics/${topic.id}`).set(authed(token))
      .send({ status: "Active" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe("Active");
  });

  it("ignores archived/superseded materials when gating activation", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const res = await request(app).post("/v1/implementation/awareness-topics").set(authed(token)).send({
      title: "Stale material", status: "Active",
      data: { materials: [{ title: "Old", fileName: "old.pdf", superseded: true }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MATERIAL_REQUIRED");
  });

  // --- Campaign launch (OD `awCampDoLaunch`) ---------------------------------

  it("launches a campaign: resolves the whole team and materialises one ACK + AEV row per recipient", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    await addMember(orgId, "Jennifer Susan Walters", "jwalters");
    await addMember(orgId, "Gone Person", "gone", "Inactive"); // not Active → excluded
    const topic = await makeTopic(token);
    const camp = await makeCampaign(token, {
      topics: [topic.id], dueDate: "2099-06-30",
      audience: { type: "All Team Members", members: [], roles: [], workUnits: [] },
      ackRequired: true, evalRequired: true, evalMethod: ["Manager confirmation"],
    });

    const launched = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    expect(launched.status).toBe(200);
    expect(launched.body.data.status).toBe("Active");
    const acks = launched.body.data.data.acks as AckRow[];
    const evals = launched.body.data.data.evals as EvalRow[];
    expect(acks).toHaveLength(2); // admin + Jennifer, not the Inactive user
    expect(acks.map((a) => a.id).sort()).toEqual(["ACK-0001", "ACK-0002"]);
    expect(acks[0]).toMatchObject({ status: "Pending", due: "2099-06-30", ackDate: "" });
    expect(acks[0].statement).toMatch(/^I acknowledge that I have read/);
    expect(evals).toHaveLength(2);
    expect(evals[0]).toMatchObject({ result: "Not Evaluated", method: "Manager confirmation", followupRequired: false });
    expect(launched.body.data.data.ackRate).toBe(0);

    // Launch is only valid from Draft/Scheduled — a second launch is refused.
    const again = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("blocks launch when a selected topic has no material, unless allowLaunchNoMaterial is on", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const bare = await makeTopic(token, "Bare topic", false);
    const camp = await makeCampaign(token, {
      topics: [bare.id], dueDate: "2099-06-30",
      audience: { type: "All Team Members" }, ackRequired: true, evalRequired: false,
    });
    const blocked = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("MATERIAL_REQUIRED");

    await request(app).put("/v1/implementation/awareness/settings").set(authed(token)).send({ allowLaunchNoMaterial: true });
    const allowed = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    expect(allowed.status).toBe(200);
  });

  it("requires topics and a due date to launch", async () => {
    const { token } = await makeTenant("aw1", "AWT1");
    const noTopics = await makeCampaign(token, { topics: [], dueDate: "2099-06-30" }, "No topics");
    expect((await request(app).post(`/v1/implementation/awareness-campaigns/${noTopics.id}/launch`).set(authed(token))).body.error.code).toBe("TOPICS_REQUIRED");
    const topic = await makeTopic(token);
    const noDue = await makeCampaign(token, { topics: [topic.id] }, "No due");
    expect((await request(app).post(`/v1/implementation/awareness-campaigns/${noDue.id}/launch`).set(authed(token))).body.error.code).toBe("DUE_REQUIRED");
  });

  it("resolves a Roles audience against role assignments (OD awResolveAudience)", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const inRole = await addMember(orgId, "Priya Patel", "ppatel");
    await addMember(orgId, "Jordan Cole", "jcole"); // not in the role → excluded
    const template = await RoleTemplate.create({ orgId, code: "RT-0001", name: "Security Champion", category: "Information Security", purpose: null, workUnits: [], processes: [], frameworks: [], responsibilities: [], authorities: [], status: "Active", notes: null, createdBy: null });
    await RoleAssignment.create({ orgId, code: "RA-0001", memberId: inRole.id, memberName: inRole.fullName, roleId: template.id, roleName: template.name, workUnit: "Security", effectiveDate: null, responsibilities: [], authorities: [], modified: false, modReason: null, modSummary: null, modifiedBy: null, modifiedDate: null, status: "Active", notes: null, createdBy: null });

    const topic = await makeTopic(token);
    const camp = await makeCampaign(token, {
      topics: [topic.id], dueDate: "2099-06-30",
      audience: { type: "Roles", members: [], roles: [template.id], workUnits: [] },
      ackRequired: true, evalRequired: false,
    });
    const launched = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    const acks = launched.body.data.data.acks as AckRow[];
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ memberId: inRole.id, memberName: "Priya Patel" });
  });

  // --- Acknowledgment mutations ----------------------------------------------

  async function launchedCampaign(token: string, orgId: string, due = "2099-06-30") {
    const member = await addMember(orgId, "Priya Patel", `ppatel${Math.random().toString(36).slice(2, 7)}`);
    const topic = await makeTopic(token);
    const camp = await makeCampaign(token, {
      topics: [topic.id], dueDate: due,
      audience: { type: "All Team Members", members: [], roles: [], workUnits: [] },
      ackRequired: true, evalRequired: true, evalMethod: ["Quiz"],
    });
    const launched = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(token));
    expect(launched.status).toBe(200);
    return { camp, member, topic, data: launched.body.data.data as { acks: AckRow[]; evals: EvalRow[] } };
  }

  it("marks an acknowledgment acknowledged and refreshes the roll-ups", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const ack = data.acks[0];
    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${ack.id}/acknowledge`).set(authed(token));
    expect(res.status).toBe(200);
    const updated = (res.body.data.data.acks as AckRow[]).find((a) => a.id === ack.id)!;
    expect(updated.status).toBe("Acknowledged");
    expect(updated.ackDate).not.toBe("");
    expect(res.body.data.data.ackRate).toBe(50); // 1 of 2 recipients done

    // Final acks cannot be re-acknowledged or waived.
    const again = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${ack.id}/acknowledge`).set(authed(token));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("ACK_ALREADY_FINAL");
  });

  it("waives an acknowledgment only with a reason, stamping who and when", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const ack = data.acks[0];
    const noReason = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${ack.id}/waive`).set(authed(token)).send({});
    expect(noReason.status).toBe(400);
    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${ack.id}/waive`).set(authed(token))
      .send({ reason: "On long-term leave" });
    expect(res.status).toBe(200);
    const updated = (res.body.data.data.acks as AckRow[]).find((a) => a.id === ack.id)!;
    expect(updated).toMatchObject({ status: "Waived", waiverReason: "On long-term leave" });
    expect((updated as unknown as { waivedBy: string }).waivedBy).toBe("Tenant Administrator");
  });

  it("sends a reminder: stamps reminderDate and raises a bell notification for the member", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const ack = data.acks[0];
    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${ack.id}/remind`).set(authed(token));
    expect(res.status).toBe(200);
    const updated = (res.body.data.data.acks as AckRow[]).find((a) => a.id === ack.id)!;
    expect(updated.reminderDate).not.toBe("");
    const notes = await Notification.findAll({ where: { userId: ack.memberId } });
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain("Awareness reminder");

    // The org can switch reminders off entirely.
    await request(app).put("/v1/implementation/awareness/settings").set(authed(token)).send({ reminders: false });
    const blocked = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${data.acks[1].id}/remind`).set(authed(token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("REMINDERS_DISABLED");
  });

  // --- Evaluation mutations ---------------------------------------------------

  it("records an evaluation result; Failed arms the follow-up flag", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const ev = data.evals[0];
    const bad = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/result`).set(authed(token))
      .send({ result: "Aced it" });
    expect(bad.status).toBe(400);

    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/result`).set(authed(token))
      .send({ result: "Failed", method: "Quiz", score: "35%", notes: "Retake needed" });
    expect(res.status).toBe(200);
    const updated = (res.body.data.data.evals as EvalRow[]).find((e) => e.id === ev.id)!;
    expect(updated).toMatchObject({ result: "Failed", method: "Quiz", followupRequired: true });
    expect((updated as unknown as { evaluator: string }).evaluator).toBe("Tenant Administrator");
  });

  it("creates a follow-up action from a failed evaluation (OD awEvalFollowup)", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const ev = data.evals[0];

    // Not failed yet → refused.
    const early = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/followup`).set(authed(token))
      .send({ title: "Re-brief" });
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe("EVAL_NOT_FAILED");

    await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/result`).set(authed(token)).send({ result: "Failed" });
    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/followup`).set(authed(token))
      .send({ title: "Re-brief on phishing", priority: "High", due: "2099-07-15" });
    expect(res.status).toBe(201);
    const followups = res.body.data.data.followups as { id: string; title: string; status: string; priority: string }[];
    expect(followups).toHaveLength(1);
    expect(followups[0]).toMatchObject({ id: "AWF-0001", title: "Re-brief on phishing", status: "Open", priority: "High" });
    const updated = (res.body.data.data.evals as EvalRow[]).find((e) => e.id === ev.id)!;
    expect(updated.followupActionId).toBe("AWF-0001");
  });

  it("raises a Training Plan record from a failed evaluation with source + cross-links (OD awEvalToTP)", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, topic, data } = await launchedCampaign(token, orgId);
    const ev = data.evals[0];
    await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/result`).set(authed(token)).send({ result: "Failed" });

    const res = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/training-plan`).set(authed(token));
    expect(res.status).toBe(201);
    const training = res.body.data.training;
    expect(training.module).toBe("training");
    expect(training.code).toBe("TRN-0001");
    expect(training.status).toBe("Planned");
    expect(training.title).toContain("Awareness re-training");
    expect(training.data).toMatchObject({
      source: "Awareness Follow-up", awCampaignId: camp.id, awCampaignCode: camp.code,
      awTopicId: topic.id, awEvalId: ev.id,
    });
    const updated = (res.body.data.campaign.data.evals as EvalRow[]).find((e) => e.id === ev.id)!;
    expect(updated.followupActionId).toBe("TRN-0001");
    expect(updated.trainingPlanId).toBe(training.id);

    // It lands in the training register.
    const list = await request(app).get("/v1/implementation/training").set(authed(token));
    expect(list.body.data.map((r: { code: string }) => r.code)).toContain("TRN-0001");
  });

  // --- Derived roll-ups + statuses -------------------------------------------

  it("derives Partially Completed / Overdue / Completed on read for past-due campaigns", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId, "2020-01-31"); // already past due
    // Nothing complete → Overdue.
    let list = await request(app).get("/v1/implementation/awareness-campaigns").set(authed(token));
    let row = list.body.data.find((r: { id: string }) => r.id === camp.id);
    expect(row.status).toBe("Overdue");

    // One of four rows complete → Partially Completed; roll-ups served on data.
    await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${data.acks[0].id}/acknowledge`).set(authed(token));
    list = await request(app).get("/v1/implementation/awareness-campaigns").set(authed(token));
    row = list.body.data.find((r: { id: string }) => r.id === camp.id);
    expect(row.status).toBe("Partially Completed");
    expect(row.data.ackRate).toBe(50);
    expect(row.data.evalRate).toBe(0);

    // Everything complete → Completed.
    await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${data.acks[1].id}/acknowledge`).set(authed(token));
    for (const ev of data.evals) {
      await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/evals/${ev.id}/result`).set(authed(token)).send({ result: "Passed" });
    }
    list = await request(app).get("/v1/implementation/awareness-campaigns").set(authed(token));
    row = list.body.data.find((r: { id: string }) => r.id === camp.id);
    expect(row.status).toBe("Completed");
    expect(row.data.ackRate).toBe(100);
    expect(row.data.evalRate).toBe(100);
  });

  // --- Tenancy ----------------------------------------------------------------

  it("keeps campaigns and their ledgers tenant-scoped", async () => {
    const { token, orgId } = await makeTenant("aw1", "AWT1");
    const { camp, data } = await launchedCampaign(token, orgId);
    const other = await makeTenant("aw2", "AWT2");
    const launch = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/launch`).set(authed(other.token));
    expect([403, 404]).toContain(launch.status);
    const ackTry = await request(app).post(`/v1/implementation/awareness-campaigns/${camp.id}/acks/${data.acks[0].id}/acknowledge`).set(authed(other.token));
    expect([403, 404]).toContain(ackTry.status);
    const settings = await request(app).get("/v1/implementation/awareness/settings").set(authed(other.token));
    expect(settings.body.data.requireMaterial).toBe(true); // its own org's defaults, untouched
  });
});
