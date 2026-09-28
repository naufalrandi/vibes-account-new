import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiGeneration, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";
import { processOneJob } from "./jobs";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });
const authed = (t: string) => ({ authorization: `Bearer ${t}` });

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const o = await Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, code: string, actions: string[]) {
  const o = await org("Tenant", code);
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return res.body.data.accessToken as string;
}

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];
const topic = (title: string) => ({ id: "", title, desc: "", inputSummary: "", output: "", outputCategory: "", decisionStatus: "No Action Required", itemStatus: "Not Started", responsible: "", due: "", action: null });

async function createReview(token: string) {
  const res = await request(app).post("/v1/implementation/reviews").set(authed(token)).send({
    title: "MR 2026", status: "Scheduled",
    data: { date: "2026-06-30", time: "09:00", topics: [topic("Nonconformities and corrective actions"), topic("Scope suitability"), topic("Policy suitability")] },
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("mr-autopilot feature", () => {
  beforeAll(async () => {
    initModels();
    await loadFeatures();
  });
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("inputs: drafts per-topic inputs from register figures as a job, skipping topics without data", async () => {
    await enableAi();
    const token = await login("mr1", "MR1", MS);
    await request(app).post("/v1/implementation/nonconformities").set(authed(token)).send({ title: "Late calibration", status: "Open", data: { severity: "Major" } });
    const review = await createReview(token);
    const ncKey = review.data.topics[0].id;
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ topics: [{ topicKey: ncKey, input: "1 open NC [register:nonconformities].", trend: "not enough data", sourceIds: ["register:nonconformities", "invented"] }] })));

    const started = await request(app).post("/v1/ai/features/mr-autopilot/inputs").set(authed(token)).send({ reviewId: review.id, topics: [ncKey, "Scope suitability"] });
    expect(started.status).toBe(202);
    expect(await processOneJob()).toBe(true);
    const job = (await request(app).get(`/v1/ai/jobs/${started.body.data.jobId}`).set(authed(token))).body.data;
    expect(job.status).toBe("done");
    const [nc, scope] = job.result.topics;
    expect(nc).toMatchObject({ topicKey: ncKey, input: "1 open NC [register:nonconformities].", noData: false, sources: [{ id: "register:nonconformities" }] });
    expect(scope).toMatchObject({ title: "Scope suitability", input: "", noData: true });
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Nonconformities: 1 records in total; by status: Open 1");
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("minutes + apply-actions: drafts from notes, then attaches only the selected actions via the register", async () => {
    await enableAi();
    const token = await login("mr2", "MR2", MS);
    const review = await createReview(token);
    const policyKey = review.data.topics[2].id;
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({
      minutesSummary: "Policy reviewed.",
      decisions: [{ topicKey: policyKey, decision: "Policy to be revised" }, { topicKey: "bogus", decision: "Other" }],
      actions: [{ topicKey: policyKey, action: "Revise the quality policy", ownerName: "Budi", due: "2026-08-01" }, { topicKey: null, action: "Book room", ownerName: null, due: "next week" }],
    })));
    const drafted = await request(app).post("/v1/ai/features/mr-autopilot/minutes").set(authed(token)).send({ reviewId: review.id, notes: "Budi will revise the quality policy by 1 Aug." });
    expect(drafted.status).toBe(200);
    expect(drafted.body.data.decisions[1].topicKey).toBeNull();
    expect(drafted.body.data.actions[1]).toMatchObject({ topicKey: null, due: null });
    const generationId = drafted.body.data.generationId;

    const bad = await request(app).post("/v1/ai/features/mr-autopilot/apply-actions").set(authed(token))
      .send({ reviewId: review.id, generationId: "00000000-0000-4000-8000-000000000000", actions: [{ topicKey: policyKey, action: "x" }] });
    expect(bad.body.error.code).toBe("GENERATION_NOT_FOUND");

    const applied = await request(app).post("/v1/ai/features/mr-autopilot/apply-actions").set(authed(token))
      .send({ reviewId: review.id, generationId, actions: [{ topicKey: policyKey, action: "Revise the quality policy", ownerName: "Budi", due: "2026-08-01" }] });
    expect(applied.status).toBe(200);
    const saved = applied.body.data.review;
    expect(saved.data.openActions).toBe(1);
    expect(saved.data.topics[2].action).toMatchObject({ title: "Revise the quality policy", owner: "Budi", status: "Open" });
    expect(saved.data.topics[0].action).toBeNull();

    const again = await request(app).post("/v1/ai/features/mr-autopilot/apply-actions").set(authed(token))
      .send({ reviewId: review.id, generationId, actions: [{ topicKey: policyKey, action: "dup" }] });
    expect(again.body.error.code).toBe("ACTION_TOPIC_CONFLICT");
    expect(await AiGeneration.count({ where: { feature: "mr-autopilot" } })).toBe(1);
  });

  it("is org-scoped and permission-gated", async () => {
    await enableAi();
    const a = await login("mr3", "MR3", MS);
    const review = await createReview(a);
    const b = await login("mr4", "MR4", MS);
    const other = await request(app).post("/v1/ai/features/mr-autopilot/minutes").set(authed(b)).send({ reviewId: review.id, notes: "x" });
    expect(other.status).toBe(404);
    const reader = await login("mr5", "MR5", [ACTIONS.MS_READ]);
    expect((await request(app).post("/v1/ai/features/mr-autopilot/minutes").set(authed(reader)).send({ reviewId: review.id, notes: "x" })).status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
