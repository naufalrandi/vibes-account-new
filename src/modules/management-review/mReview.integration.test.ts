import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MR = [ACTIONS.MREVIEW_READ, ACTIONS.MREVIEW_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = MR): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Top Management", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

const SCHEDULE = {
  title: "Q3 2026 Management Review",
  frameworks: ["ISO 9001:2015"],
  date: "2026-09-30",
  time: "10:00",
  format: "Virtual",
  chairperson: "Top Management",
  recorder: "QM",
  invited: [{ name: "Top Management", req: "Required", att: "Pending" }],
  agenda: "Standing ISO 9.3 agenda.",
  topics: ["Internal audit results", "Customer satisfaction and feedback"],
};

describe("management review", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("schedules a review seeded from the standard topic catalog, and rejects unknown/missing fields", async () => {
    const { token } = await makeTenant("mr1", "MR1");

    expect((await request(app).post("/v1/management-review").set(authed(token)).send({ ...SCHEDULE, time: "" })).status).toBe(400);
    expect((await request(app).post("/v1/management-review").set(authed(token)).send({ ...SCHEDULE, topics: ["Not a real topic"] })).status).toBe(400);

    const created = await request(app).post("/v1/management-review").set(authed(token)).send(SCHEDULE);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "MR-0001", status: "Draft", format: "Virtual" });
    expect(created.body.data.topics).toHaveLength(2);
    expect(created.body.data.topics.map((t: { title: string }) => t.title).sort()).toEqual(
      ["Customer satisfaction and feedback", "Internal audit results"],
    );
    expect(created.body.data.topics[0]).toMatchObject({ itemStatus: "Not Started", decisionStatus: "No Action Required" });
  });

  it("merges the topic set on update: keeps recorded entries, adds new blanks, drops deselected", async () => {
    const { token } = await makeTenant("mr2", "MR2");
    const created = await request(app).post("/v1/management-review").set(authed(token)).send(SCHEDULE);
    const id = created.body.data.id;
    const iaTopic = created.body.data.topics.find((t: { title: string }) => t.title === "Internal audit results");

    // Record an output on the internal-audit topic first.
    await request(app).post(`/v1/management-review/${id}/record`).set(authed(token))
      .send({ topics: [{ id: iaTopic.id, inputSummary: "3 findings raised this cycle.", itemStatus: "Reviewed" }] });

    // Update: drop "Customer satisfaction...", keep "Internal audit results", add "Risk and opportunity status".
    const updated = await request(app).put(`/v1/management-review/${id}`).set(authed(token))
      .send({ topics: ["Internal audit results", "Risk and opportunity status"] });
    expect(updated.status).toBe(200);
    const titles = updated.body.data.topics.map((t: { title: string }) => t.title).sort();
    expect(titles).toEqual(["Internal audit results", "Risk and opportunity status"]);
    const keptIa = updated.body.data.topics.find((t: { title: string }) => t.title === "Internal audit results");
    expect(keptIa.inputSummary).toBe("3 findings raised this cycle.");
    expect(keptIa.itemStatus).toBe("Reviewed");
    const newTopic = updated.body.data.topics.find((t: { title: string }) => t.title === "Risk and opportunity status");
    expect(newTopic.itemStatus).toBe("Not Started");
  });

  it("records topic outputs, moves status to Pending Outputs, then finalizes", async () => {
    const { token } = await makeTenant("mr3", "MR3");
    const created = await request(app).post("/v1/management-review").set(authed(token)).send(SCHEDULE);
    const id = created.body.data.id;
    const topic = created.body.data.topics[0];

    const invalidOutput = await request(app).post(`/v1/management-review/${id}/record`).set(authed(token))
      .send({ topics: [{ id: topic.id, outputCategory: "Not A Category" }] });
    expect(invalidOutput.status).toBe(400);

    const recorded = await request(app).post(`/v1/management-review/${id}/record`).set(authed(token)).send({
      topics: [{
        id: topic.id, inputSummary: "Reviewed.", output: "Continue current controls.",
        outputCategory: "No Action Required", decisionStatus: "No Action Required", itemStatus: "Decision Recorded",
      }],
    });
    expect(recorded.status).toBe(200);
    expect(recorded.body.data.status).toBe("Pending Outputs");
    expect(recorded.body.data.topics.find((t: { id: string }) => t.id === topic.id)).toMatchObject({ itemStatus: "Decision Recorded", output: "Continue current controls." });

    const finalized = await request(app).post(`/v1/management-review/${id}/status`).set(authed(token)).send({ status: "Finalized" });
    expect(finalized.body.data.status).toBe("Finalized");
    expect(finalized.body.data.finalizedBy).toBe("Top Management");
    expect(finalized.body.data.finalizedDate).toBeTruthy();
  });

  it("scopes per tenant and enforces action grants", async () => {
    const a = await makeTenant("mr4", "MR4");
    const b = await makeTenant("mr5", "MR5");
    await request(app).post("/v1/management-review").set(authed(a.token)).send(SCHEDULE);
    expect((await request(app).get("/v1/management-review").set(authed(b.token))).body.data).toHaveLength(0);

    const noGrant = await makeTenant("mr6", "MR6", []);
    expect((await request(app).get("/v1/management-review").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("mr7", "MR7", [ACTIONS.MREVIEW_READ]);
    expect((await request(app).get("/v1/management-review").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/management-review").set(authed(readonly.token)).send(SCHEDULE)).status).toBe(403);
  });
});
