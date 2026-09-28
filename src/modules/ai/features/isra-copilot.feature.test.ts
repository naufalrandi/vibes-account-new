import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import {
  initModels, AiConnection, AiGeneration, IsraAnnexAControl, IsraKmVulnControl, IsraScenario,
  IsraScenarioRecommendationDisposition, IsraSoaJustification, IsraThreatLibrary, IsraVulnLibrary, Organization, Role, User,
} from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";
import { processOneJob } from "./jobs";

const app = createApp();
const reply = (value: unknown) => ({ text: JSON.stringify(value), model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });
const ISRA = [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_ORG_CONTROL_READ, ACTIONS.ISRA_ORG_CONTROL_MANAGE];

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const existing = await Organization.findOne({ where: { code } });
  if (existing) return existing;
  const o = await Organization.create({
    name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, actions: string[]) {
  const o = await org("Tenant", "ISRA_AI");
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id };
}

const post = (auth: string, path: string, body: object = {}) => request(app).post(path).set("authorization", auth).send(body);
const put = (auth: string, path: string, body: object) => request(app).put(path).set("authorization", auth).send(body);

async function seedLibraries() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
  await IsraThreatLibrary.findOrCreate({ where: { id: "THR-0002" }, defaults: { id: "THR-0002", name: "Account takeover", category: "Identity", description: "Takeover" } });
  await IsraVulnLibrary.findOrCreate({ where: { id: "VUL-0071" }, defaults: { id: "VUL-0071", name: "Absence of MFA", category: "Identity", description: "No MFA" } });
  for (const [ref, name] of [["A.8.5", "Secure authentication"], ["A.5.15", "Access control"]]) {
    await IsraAnnexAControl.findOrCreate({ where: { ref }, defaults: { ref, name, category: "Technological", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false } });
  }
  await IsraKmVulnControl.findOrCreate({
    where: { id: "KVC-T1" },
    defaults: { id: "KVC-T1", vulnId: "VUL-0071", annexRef: "A.8.5", mechanism: "Secure authentication mitigates absence of MFA.", status: "Approved" } as never,
  });
}

async function scenario(auth: string) {
  const res = await post(auth, "/v1/isra/scenarios", {
    title: "Takeover", primaryAssetRef: "PAL-001", secondaryAssetRef: "SAL-001", threatId: "THR-0002", includedVulns: ["VUL-0071"],
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; inherentL: number };
}

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("isra-copilot feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("drafts a scenario with platform few-shot examples and writes nothing", async () => {
    await seedLibraries();
    const { auth } = await login("isra1", ISRA);
    ai.complete.mockResolvedValueOnce(reply({
      title: "Account takeover via missing MFA", ciaDesc: { c: "Customer data exposed" }, likelihoodNote: "Likely [VUL-0071]",
      impactNotes: [{ area: "privacy", note: "Personal data exposed" }], citations: ["THR-0002", "VUL-0071"],
    }));
    const before = await IsraScenario.count();
    const res = await post(auth, "/v1/ai/features/isra-copilot/scenario-draft", { threatId: "THR-0002", vulnIds: ["VUL-0071"] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Account takeover via missing MFA", impactNotes: [{ area: "privacy" }], generationId: expect.any(String) });
    expect(await IsraScenario.count()).toBe(before);
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("[THR-0002] Threat: Account takeover");
    expect(prompt).toContain("EX-1"); // same-threat platform sample (RSC-0001 is THR-0002)
  });

  it("refuses callers without ISRA manage", async () => {
    await seedLibraries();
    const { auth } = await login("isra2", [ACTIONS.ISRA_LIBRARY_READ]);
    const res = await post(auth, "/v1/ai/features/isra-copilot/scenario-draft", { threatId: "THR-0002", vulnIds: ["VUL-0071"] });
    expect(res.status).toBe(403);
  });

  it("suggests dispositions only for recommended controls, with mechanism sources, and never rules", async () => {
    await seedLibraries();
    const { auth } = await login("isra3", ISRA);
    const sc = await scenario(auth);
    expect((await post(auth, `/v1/isra/scenarios/${sc.id}/recommendations`)).status).toBe(200);
    ai.complete.mockResolvedValueOnce(reply({ suggestions: [
      { annexRef: "A.8.5", suggestedDisposition: "Selected", rationale: "Addresses [VUL-0071]" },
      { annexRef: "A.9.99", suggestedDisposition: "Selected", rationale: "invented" },
    ] }));
    const res = await post(auth, "/v1/ai/features/isra-copilot/control-rationale", { scenarioId: sc.id });
    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([
      { annexRef: "A.8.5", suggestedDisposition: "Selected", rationale: "Addresses [VUL-0071]", mechanismSource: "KVC-T1" },
    ]);
    expect(await IsraScenarioRecommendationDisposition.count({ where: { scenarioId: sc.id } })).toBe(0);
  });

  it("drafts an RTP without touching the scenario's scores", async () => {
    await seedLibraries();
    const { auth } = await login("isra4", ISRA);
    const sc = await scenario(auth);
    ai.complete.mockResolvedValueOnce(reply({
      description: "Roll out MFA", expectedEvidence: "IdP export", monitoring: "Monthly review", completionCriteria: "All users enrolled",
      actions: [{ action: "Enable MFA", ownerRole: "IT Security Lead", evidenceRequired: "Policy export", completionCriteria: "100% enrolled", targetOffsetDays: 30 }],
    }));
    const res = await post(auth, "/v1/ai/features/isra-copilot/rtp-draft", { scenarioId: sc.id });
    expect(res.status).toBe(200);
    expect(res.body.data.actions[0]).toMatchObject({ ownerRole: "IT Security Lead", targetOffsetDays: 30 });
    const after = await IsraScenario.findByPk(sc.id);
    expect(after?.inherentL).toBe(sc.inherentL);
  });

  it("soa-justify drafts only empty justifications in batches and saves nothing", async () => {
    await seedLibraries();
    const { auth, orgId } = await login("isra5", ISRA);
    expect((await put(auth, "/v1/isra/soa/A.5.15/justification", { justification: "Written by the ISMS manager" })).status).toBe(200);
    ai.complete.mockImplementation(async (req: { messages: { content: string }[] }) => {
      const refs = [...req.messages[0].content.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
      return reply({ justifications: refs.map((annexRef) => ({ annexRef, justification: `Draft for ${annexRef}` })) });
    });
    const started = await post(auth, "/v1/ai/features/isra-copilot/soa-justify", {});
    expect(started.status).toBe(202);
    await processOneJob();
    const job = await request(app).get(`/v1/ai/jobs/${started.body.data.jobId}`).set("authorization", auth);
    expect(job.body.data.status).toBe("done");
    const refs = job.body.data.result.drafts.map((d: { annexRef: string }) => d.annexRef);
    expect(refs).toContain("A.8.5");
    expect(refs).not.toContain("A.5.15");
    expect(job.body.data.result.saved).toBe(false);
    const rows = await IsraSoaJustification.findAll({ where: { orgId } });
    expect(rows.map((r) => r.justification)).toEqual(["Written by the ISMS manager"]);
  });

  it("drafts risk action plans as Draft and does not add them to the risk", async () => {
    await seedLibraries();
    const { auth } = await login("risk1", [ACTIONS.MS_READ, ACTIONS.MS_MANAGE]);
    const risk = await post(auth, "/v1/risks", { title: "Supplier outage", description: "Key supplier fails; call 0812-3456-7890" });
    expect(risk.status).toBe(201);
    ai.complete.mockResolvedValueOnce(reply({ actionPlans: [
      { title: "Qualify a second supplier", description: "Shortlist and audit", ownerRole: "Procurement Lead", due: "2999-01-31" },
      { title: "Past-dated", description: "x", ownerRole: "Ops", due: "2000-01-01" },
    ] }));
    const res = await post(auth, "/v1/ai/features/isra-copilot/risk-action-plan", { riskId: risk.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data.actionPlans).toEqual([
      expect.objectContaining({ title: "Qualify a second supplier", due: "2999-01-31", status: "Draft" }),
      expect.objectContaining({ title: "Past-dated", due: "", status: "Draft" }),
    ]);
    expect(ai.complete.mock.calls[0][0].messages[0].content).not.toContain("0812-3456-7890");
    const reread = await request(app).get(`/v1/risks/${risk.body.data.id}`).set("authorization", auth);
    expect(reread.body.data.rtp).toBeNull();
    expect(await AiGeneration.count({ where: { feature: "isra-copilot", action: "risk-action-plan" } })).toBe(1);
  });
});
