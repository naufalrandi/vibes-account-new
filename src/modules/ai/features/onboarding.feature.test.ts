import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import {
  initModels, AiConnection, BusinessProcess, Framework, FrameworkRequirement, ImplementationRecord, IpParty, IpRequirement,
  MsScope, Organization, Role, User,
} from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const o = await Organization.create({
    name: code, code, type, status: "Active", parentOrgId: null, tenantId: null,
    email: null, phone: null, website: null, country: null, address: null,
  });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, actions: string[]) {
  const o = await org("Tenant", `T-${username}`);
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id };
}

async function enableAi() {
  const so = await org("ServiceOwner", "SO");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const ALL = [ACTIONS.SCOPE_MANAGE, ACTIONS.MS_MANAGE, ACTIONS.IP_MANAGE, ACTIONS.PROCESS_MANAGE];

const SUGGESTIONS = {
  scope: { statement: "Design and delivery of software.", exclusions: [{ clauseRef: "8.3", justification: "n/a" }, { clauseRef: "99.1", justification: "invented" }] },
  contextIssues: [
    { domain: "Technological", type: "internal", title: "Legacy spreadsheets", description: "d" },
    { domain: "Market", type: "external", title: "Existing issue", description: "dup" },
  ],
  interestedParties: [{ name: "Customers", category: "Clients or Customers", needs: ["On-time delivery"] }],
  processes: [{ catalogName: "Software Testing", reason: "r" }, { catalogName: "Invented Process", reason: "r" }],
  objectives: [{ title: "Reduce defects", target: "-20%", measure: "Defects per release", due: "2027-06-30" }],
};

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("onboarding feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("suggests drafts with catalog/clause/duplicate filtering, then applies only the selection", async () => {
    await enableAi();
    const fw = await Framework.create({ name: "ISO 9001:2015", groupId: null, familyId: null, code: "ISO9001", version: null, status: "Active", shortDescription: null, fullDescription: null, jurisdictions: ["Global"], publishedDate: null });
    await FrameworkRequirement.create({ frameworkId: fw.id, code: "8.3", subject: "Design and development", description: "d", status: "Active" });
    const { auth, orgId } = await login("adm", ALL);
    await post(auth, "/v1/implementation/context", { title: "Existing issue" });

    ai.complete.mockResolvedValueOnce(reply(JSON.stringify(SUGGESTIONS)));
    const res = await post(auth, "/v1/ai/features/onboarding/suggest", {
      kbli: "62019", industryDescription: "Custom software house", employees: 40, frameworks: ["ISO9001"],
    });
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.scope.exclusions.map((e: { clauseRef: string }) => e.clauseRef)).toEqual(["8.3"]);
    expect(s.contextIssues.map((c: { title: string }) => c.title)).toEqual(["Legacy spreadsheets"]);
    expect(s.processes.map((p: { catalogName: string }) => p.catalogName)).toEqual(["Software Testing"]);
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("ISO9001 8.3 — Design and development");
    expect(prompt).toContain("Existing issue");

    const applied = await post(auth, "/v1/ai/features/onboarding/apply", {
      generationId: s.generationId,
      selections: {
        scope: s.scope,
        contextIssues: s.contextIssues,
        interestedParties: s.interestedParties,
        processes: [...s.processes, { catalogName: "Invented Process" }],
        objectives: [],
      },
    });
    expect(applied.status).toBe(200);
    expect(applied.body.data.created).toEqual({ scope: 1, contextIssues: 1, interestedParties: 1, processes: 1, objectives: 0 });
    expect(applied.body.data.skipped.processes).toBe(1);
    expect(await MsScope.findOne({ where: { orgId } })).toMatchObject({ status: "Draft", statement: "Design and delivery of software." });
    expect(await ImplementationRecord.count({ where: { orgId, module: "context" } })).toBe(2);
    expect(await ImplementationRecord.count({ where: { orgId, module: "objectives" } })).toBe(0);
    const party = await IpParty.findOne({ where: { orgId } });
    expect(await IpRequirement.count({ where: { partyId: party!.id } })).toBe(1);
    expect(await BusinessProcess.findOne({ where: { orgId, name: "Software Testing" } })).toMatchObject({ sourceType: "Catalog" });

    // Re-applying the same selection creates nothing new.
    const again = await post(auth, "/v1/ai/features/onboarding/apply", { generationId: s.generationId, selections: { contextIssues: s.contextIssues } });
    expect(again.body.data.created.contextIssues).toBe(0);
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects a generation from another org and callers without manage rights", async () => {
    await enableAi();
    const plain = await login("viewer", [ACTIONS.SCOPE_READ]);
    expect((await post(plain.auth, "/v1/ai/features/onboarding/suggest", { industryDescription: "abc", frameworks: ["X"] })).status).toBe(403);

    const a = await login("a", ALL);
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ ...SUGGESTIONS, contextIssues: [] })));
    const s = (await post(a.auth, "/v1/ai/features/onboarding/suggest", { industryDescription: "abc", frameworks: ["X"] })).body.data;
    const b = await login("b", ALL);
    const res = await post(b.auth, "/v1/ai/features/onboarding/apply", { generationId: s.generationId, selections: {} });
    expect(res.status).toBe(404);
  });
});
