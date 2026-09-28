import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiGeneration, ImplementationRecord, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (obj: unknown) => ({ text: JSON.stringify(obj), model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string): Promise<Organization> {
  const existing = await Organization.findOne({ where: { code } });
  if (existing) return existing;
  const o = await Organization.create({
    name: code, code, type, status: "Active", parentOrgId: null, tenantId: null,
    email: null, phone: null, website: null, country: null, address: null,
  });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(type: "ServiceOwner" | "Tenant", username: string, opts: { superAdmin?: boolean; actions?: string[]; orgCode?: string } = {}) {
  const o = await org(type, opts.orgCode ?? type);
  const user = await User.create({
    orgId: o.id, tenantId: type === "Tenant" ? o.id : null, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: o.id, isSuperAdmin: opts.superAdmin ?? false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (opts.actions?.length) await grantActions(role.id, opts.actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id, userId: user.id };
}

const get = (auth: string, path: string) => request(app).get(path).set("authorization", auth);
const post = (auth: string, path: string, body: object = {}) => request(app).post(path).set("authorization", auth).send(body);
const put = (auth: string, path: string, body: object) => request(app).put(path).set("authorization", auth).send(body);

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}


const MANAGE = ["ms.read", "ms.manage"];

async function createRecord(auth: string, module: string, title: string, data: object) {
  const res = await post(auth, `/v1/implementation/${module}`, { title, data });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; code: string };
}

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("capa-copilot feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("rca: returns a structured 5-why draft plus similar past NCs found in code", async () => {
    await enableAi();
    const { auth } = await login("Tenant", "q1", { actions: MANAGE });
    const nc = await createRecord(auth, "nonconformities", "Pressure gauge calibration overdue", { description: "Gauge calibration certificate expired in lab 2" });
    const past = await createRecord(auth, "nonconformities", "Pressure gauge calibration expired", { description: "Gauge certificate expired", rootCause: "No recall schedule" });
    await createRecord(auth, "nonconformities", "Invoice paid late", { description: "Supplier payment delayed" });
    ai.complete.mockResolvedValueOnce(reply({
      analysis: { whys: [{ question: "Why expired?", answer: "No recall schedule" }] },
      rootCause: "No calibration recall schedule",
      openQuestions: ["Who owns the schedule?"],
    }));

    const res = await post(auth, "/v1/ai/features/capa-copilot/rca", { ncId: nc.id, method: "5-why" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      method: "5-why", rootCause: "No calibration recall schedule", openQuestions: ["Who owns the schedule?"],
      similarPast: [{ id: past.id, code: past.code, title: "Pressure gauge calibration expired" }],
    });
    const gen = await AiGeneration.findByPk(res.body.data.generationId);
    expect(gen).toMatchObject({ feature: "capa-copilot", action: "rca", targetType: "nonconformities", targetId: nc.id, status: "draft" });
    // The prompt cites the similar record by code; the NC itself was not changed.
    expect(JSON.stringify(ai.complete.mock.calls[0][0])).toContain(past.code);
    expect((await ImplementationRecord.findByPk(nc.id))!.status).toBe("Open");
  });

  it("rca: 400 unless exactly one of ncId / incidentId, 404 for another org's record, 403 without ms.manage", async () => {
    await enableAi();
    const a = await login("Tenant", "q1", { actions: MANAGE, orgCode: "A" });
    const b = await login("Tenant", "q2", { actions: MANAGE, orgCode: "B" });
    const reader = await login("Tenant", "q3", { actions: ["ms.read"], orgCode: "A" });
    const nc = await createRecord(a.auth, "nonconformities", "NC", { description: "x" });
    expect((await post(a.auth, "/v1/ai/features/capa-copilot/rca", { method: "5-why" })).status).toBe(400);
    expect((await post(b.auth, "/v1/ai/features/capa-copilot/rca", { ncId: nc.id })).status).toBe(404);
    expect((await post(reader.auth, "/v1/ai/features/capa-copilot/rca", { ncId: nc.id })).status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("cap: needs a root cause first, then returns an action draft", async () => {
    await enableAi();
    const { auth } = await login("Tenant", "q1", { actions: MANAGE });
    const bare = await createRecord(auth, "nonconformities", "NC", { description: "x" });
    expect((await post(auth, "/v1/ai/features/capa-copilot/cap", { ncId: bare.id })).status).toBe(400);

    const nc = await createRecord(auth, "nonconformities", "NC 2", { description: "x", rootCause: "No recall schedule" });
    const draft = { correction: "Recalibrate", correctiveAction: "Add recall schedule", resources: "QA lead", effectivenessMethod: "Audit 3 months", effectivenessDueDays: 90 };
    ai.complete.mockResolvedValueOnce(reply(draft));
    const res = await post(auth, "/v1/ai/features/capa-copilot/cap", { ncId: nc.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject(draft);
    expect(res.body.data.generationId).toEqual(expect.any(String));

    // The editor's unsaved RCA text is enough on its own.
    ai.complete.mockResolvedValueOnce(reply(draft));
    const fromForm = await post(auth, "/v1/ai/features/capa-copilot/cap", { ncId: bare.id, rootCause: "Typed in the editor" });
    expect(fromForm.status).toBe(200);
    expect(JSON.stringify(ai.complete.mock.calls[1][0])).toContain("Typed in the editor");
  });

  it("incident-report: drafts investigation, root cause, corrective action and follow-ups", async () => {
    await enableAi();
    const { auth } = await login("Tenant", "q1", { actions: MANAGE });
    const inc = await createRecord(auth, "incidents", "Unauthorized access attempt", { description: "Brute force on VPN", type: "Security" });
    const draft = { investigation: "Logs show…", rootCause: "No lockout", correctiveAction: "Enable lockout", followups: ["Review VPN logs weekly"] };
    ai.complete.mockResolvedValueOnce(reply(draft));
    const res = await post(auth, "/v1/ai/features/capa-copilot/incident-report", { incidentId: inc.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject(draft);
  });
});
