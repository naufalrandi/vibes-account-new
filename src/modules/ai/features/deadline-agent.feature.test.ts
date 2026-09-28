import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiFeatureFlag, AiGeneration, ImplementationRecord, Notification, Organization, Role, User } from "../../../db/models";
import { todayInTz } from "../../../lib/localDate";
import { testOutbox } from "../../../lib/mailer";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { addDays } from "../deadlines/scan";
import { digestOrg, runDailyDigests } from "../deadlines/digest";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });

// 02:00 UTC = 09:00 in the default org timezone (Asia/Jakarta): after the 07:00 digest hour.
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T02:00:00Z`);
const EARLY = new Date(NOW.getTime() - 3 * 3_600_000); // 06:00 Jakarta
const TODAY = todayInTz("Asia/Jakarta", NOW);

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

async function login(username: string, opts: { actions?: string[]; type?: "ServiceOwner" | "Tenant" } = {}) {
  const type = opts.type ?? "Tenant";
  const o = await org(type, type === "Tenant" ? "TEN" : "SO");
  const user = await User.create({
    orgId: o.id, tenantId: type === "Tenant" ? o.id : null, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (opts.actions?.length) await grantActions(role.id, opts.actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id, userId: user.id };
}

async function enableAi() {
  const so = await org("ServiceOwner", "SO");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const nc = (orgId: string, code: string, pic: string, due: string) =>
  ImplementationRecord.create({
    orgId, module: "nonconformities", code, title: `Finding ${code}`, status: "Open", owner: null,
    data: { pic, due }, elementId: null, frameworks: [],
  });

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("deadline-agent", () => {
  beforeEach(() => {
    ai.complete.mockReset();
    testOutbox.length = 0;
  });
  afterEach(() => resetDb());

  it("dashboard lists only the caller's items; unresolved owners go to the module managers", async () => {
    const jane = await login("jane");
    const bob = await login("bob", { actions: ["ms.manage"] });
    await nc(jane.orgId, "NC-0001", "jane", addDays(TODAY, -1));
    await nc(jane.orgId, "NC-0002", "Someone Gone", TODAY);
    await nc(jane.orgId, "NC-0003", "jane", addDays(TODAY, 60)); // beyond the horizon

    const mine = await request(app).get("/v1/dashboard/deadlines").set("authorization", jane.auth);
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.map((i: { code: string }) => i.code)).toEqual(["NC-0001"]);
    expect(mine.body.data.items[0]).toMatchObject({ urgency: "overdue", daysLeft: -1, link: "/implementation/issues" });
    expect(mine.body.data.counts).toEqual({ overdue: 1, today: 0, week: 0, later: 0 });

    const managers = await request(app).get("/v1/dashboard/deadlines").set("authorization", bob.auth);
    expect(managers.body.data.items.map((i: { code: string }) => i.code)).toEqual(["NC-0002"]);
  });

  it("digest-preview returns the caller's items with an AI summary", async () => {
    await enableAi();
    const jane = await login("jane");
    await nc(jane.orgId, "NC-0001", "jane", TODAY);
    ai.complete.mockResolvedValueOnce(reply("Close NC-0001 today."));
    const res = await request(app).post("/v1/ai/features/deadline-agent/digest-preview").set("authorization", jane.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ summary: "Close NC-0001 today.", counts: { today: 1 }, generationId: expect.any(String) });
    expect(ai.complete.mock.calls[0][0].messages[0].content).toContain("[NC-0001]");
  });

  it("sends one template digest per user per day without AI, and never twice", async () => {
    const jane = await login("jane");
    await nc(jane.orgId, "NC-0001", "jane", addDays(TODAY, -2));
    await nc(jane.orgId, "NC-0002", "jane", addDays(TODAY, 3));

    expect(await runDailyDigests(EARLY)).toEqual([]);
    expect(testOutbox).toHaveLength(0);

    expect(await runDailyDigests(NOW)).toContain(jane.orgId);
    const mail = testOutbox.filter((m) => m.to === "jane@x.test");
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Your deadlines: 1 overdue, 1 upcoming");
    expect(mail[0].text).toContain("You have 2 items needing attention");
    expect(ai.complete).not.toHaveBeenCalled();
    expect(await Notification.count({ where: { userId: jane.userId, type: "deadline" } })).toBe(2);

    expect(await runDailyDigests(NOW)).toEqual([]); // per-org marker
    const org = (await Organization.findByPk(jane.orgId))!;
    await digestOrg(org, TODAY); // a forced rerun still dedupes the bell per item per day
    expect(await Notification.count({ where: { userId: jane.userId, type: "deadline" } })).toBe(2);
  });

  it("uses the AI intro when available and skips orgs with the feature turned off", async () => {
    await enableAi();
    const jane = await login("jane");
    await nc(jane.orgId, "NC-0001", "jane", TODAY);
    ai.complete.mockResolvedValue(reply("Start with NC-0001."));
    await runDailyDigests(NOW);
    const mail = testOutbox.find((m) => m.to === "jane@x.test")!;
    expect(mail.text).toContain("Start with NC-0001.");
    expect(await AiGeneration.count({ where: { orgId: jane.orgId, feature: "deadline-agent", userId: jane.userId } })).toBe(1);

    await resetDb();
    testOutbox.length = 0;
    const cara = await login("cara");
    await nc(cara.orgId, "NC-0001", "cara", TODAY);
    await AiFeatureFlag.create({ orgId: cara.orgId, feature: "deadline-agent", enabled: false, updatedBy: null });
    await runDailyDigests(NOW);
    expect(testOutbox).toHaveLength(0);
    const off = await request(app).get("/v1/dashboard/deadlines").set("authorization", cara.auth);
    expect(off.body.data).toMatchObject({ enabled: false, items: [] });
  });
});
