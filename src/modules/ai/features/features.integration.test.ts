import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { z } from "zod";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiGeneration, AiJob, AuditLog, Organization, Role, User } from "../../../db/models";
import { AiProviderError } from "../../../lib/errors";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { loadFeatures, registerFeature } from "./registry";
import { MAX_ATTEMPTS, ORPHANED_JOB_ERROR, processOneJob, runDueSchedules } from "./jobs";
import { defineAction } from "./types";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 11, outputTokens: 7 }, latencyMs: 42 });

const scheduleRuns = vi.fn();
beforeAll(async () => {
  initModels();
  await loadFeatures();
  registerFeature({
    key: "test-batch",
    label: "Batch",
    description: "Job-mode test feature",
    actions: {
      titles: defineAction({
        permission: ["risk.update", "risk.create"],
        mode: "job",
        input: z.object({ items: z.array(z.string()).min(1) }),
        async run(ctx) {
          const out: { title: string; generationId: string }[] = [];
          for (const [i, item] of ctx.input.items.entries()) {
            const { data, generationId } = await ctx.ai.json(z.object({ title: z.string() }), {
              system: "Title it.", user: item, target: { type: "risk", id: `R-${i}` },
            });
            out.push({ title: data.title, generationId });
            await ctx.progress?.(i + 1, ctx.input.items.length);
          }
          return { titles: out };
        },
      }),
    },
    schedules: [{ key: "test-batch:tick", everyMinutes: 60, run: scheduleRuns }],
  });
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

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("/v1/ai feature framework", () => {
  beforeEach(() => {
    ai.complete.mockReset();
    scheduleRuns.mockReset();
  });
  afterEach(() => resetDb());

  it("lists features with availability, per-org enabled state and the caller's permitted actions", async () => {
    const { auth } = await login("Tenant", "t1", { actions: ["risk.create"] });
    let res = await get(auth, "/v1/ai/features");
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    await enableAi();
    const plain = await login("Tenant", "t2");
    res = await get(plain.auth, "/v1/ai/features");
    expect(res.body.data.available).toBe(true);
    const byKey = Object.fromEntries(res.body.data.features.map((f: { key: string }) => [f.key, f]));
    expect(byKey.summarize).toEqual({ key: "summarize", label: "Summarize", description: expect.any(String), enabled: true, actions: ["text"] });
    expect(byKey["test-batch"].actions).toEqual([]);
    res = await get(auth, "/v1/ai/features");
    expect(res.body.data.features.find((f: { key: string }) => f.key === "test-batch").actions).toEqual(["titles"]);
  });

  it("gates invocations: 404 unknown, 409 not configured, 403 disabled, 403 permission, 400 input", async () => {
    const { auth } = await login("Tenant", "t1");
    expect((await post(auth, "/v1/ai/features/nope/text")).status).toBe(404);
    expect((await post(auth, "/v1/ai/features/summarize/nope")).body.error.code).toBe("AI_FEATURE_NOT_FOUND");
    expect((await post(auth, "/v1/ai/features/summarize/toString")).status).toBe(404);

    const notConfigured = await post(auth, "/v1/ai/features/summarize/text", { text: "x" });
    expect(notConfigured.status).toBe(409);
    expect(notConfigured.body.error.code).toBe("AI_NOT_CONFIGURED");

    await enableAi();
    const so = await login("ServiceOwner", "so", { superAdmin: true });
    expect((await put(so.auth, "/v1/ai/feature-flags", { feature: "summarize", enabled: false })).status).toBe(200);
    const disabled = await post(auth, "/v1/ai/features/summarize/text", { text: "x" });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe("AI_FEATURE_DISABLED");
    await put(so.auth, "/v1/ai/feature-flags", { feature: "summarize", enabled: null });

    expect((await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a"] })).status).toBe(403);

    const bad = await post(auth, "/v1/ai/features/summarize/text", { text: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect((await post(auth, "/v1/ai/features/summarize/text", { text: "x".repeat(20_001) })).status).toBe(400);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("runs a sync action, records a draft generation and audits it", async () => {
    await enableAi();
    const { auth, orgId, userId } = await login("Tenant", "t1");
    await Organization.update({ systemDefaults: { currency: "IDR", timezone: "Asia/Jakarta", country: "ID", language: "Indonesian" } }, { where: { id: orgId } });
    ai.complete.mockResolvedValueOnce(reply("  - short summary  "));
    const res = await post(auth, "/v1/ai/features/summarize/text", { text: "Long text", instruction: "Two bullets" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ summary: "- short summary", generationId: expect.any(String) });
    const call = ai.complete.mock.calls[0][0];
    expect(call.system).toContain("Write in Indonesian.");
    expect(call.messages[0].content).toContain("Instruction: Two bullets");

    const gen = await AiGeneration.findOne({ where: { id: res.body.data.generationId, orgId } });
    expect(gen).toMatchObject({ userId, feature: "summarize", action: "text", status: "draft", model: "m-test", provider: "openai", inputTokens: 11, outputTokens: 7, latencyMs: 42 });
    const audit = await AuditLog.findOne({ where: { action: "ai.generation", entityId: gen!.id } });
    expect(audit).toMatchObject({ actorUserId: userId, organizationId: orgId, tenantId: orgId, result: "Success" });
    expect(audit!.metadata).toEqual({ feature: "summarize", action: "text", model: "m-test", generationId: gen!.id });
  });

  it("records a failed generation when the provider fails", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1");
    ai.complete.mockRejectedValueOnce(new AiProviderError("Rate limited by the provider"));
    const res = await post(auth, "/v1/ai/features/summarize/text", { text: "x" });
    expect(res.status).toBe(502);
    const gen = await AiGeneration.findOne({ where: { orgId } });
    expect(gen).toMatchObject({ status: "failed", error: "Rate limited by the provider", model: null });
    expect(await AuditLog.count({ where: { action: "ai.generation", result: "Failure" } })).toBe(1);
  });

  it("queues a job, the worker runs it with progress, and only the owner org can read it", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1", { actions: ["risk.update"] });
    const res = await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a", "b"] });
    expect(res.status).toBe(202);
    const { jobId } = res.body.data;
    expect((await get(auth, `/v1/ai/jobs/${jobId}`)).body.data).toMatchObject({ id: jobId, feature: "test-batch", action: "titles", status: "queued", progress: 0, total: null, result: null, error: null });

    ai.complete.mockResolvedValueOnce(reply('{"title": "A"}')).mockResolvedValueOnce(reply('```json\n{"title": "B"}\n```'));
    expect(await processOneJob()).toBe(true);
    expect(await processOneJob()).toBe(false);

    const job = (await get(auth, `/v1/ai/jobs/${jobId}`)).body.data;
    expect(job).toMatchObject({ status: "done", progress: 2, total: 2, error: null });
    expect(job.result.titles.map((t: { title: string }) => t.title)).toEqual(["A", "B"]);
    expect(await AiGeneration.count({ where: { orgId, feature: "test-batch", targetType: "risk" } })).toBe(2);

    const other = await login("Tenant", "t9", { orgCode: "OtherTenant" });
    expect((await get(other.auth, `/v1/ai/jobs/${jobId}`)).status).toBe(404);
    expect((await get(other.auth, "/v1/ai/jobs/not-a-uuid")).status).toBe(404);
  });

  it("retries a provider failure once, then fails the job", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1", { actions: ["risk.create"] });
    const { jobId } = (await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a"] })).body.data;
    ai.complete.mockRejectedValue(new AiProviderError("The provider returned an error (HTTP 500)"));

    expect(await processOneJob()).toBe(true);
    let job = await AiJob.findOne({ where: { id: jobId, orgId } });
    expect(job).toMatchObject({ status: "queued", attempts: 1, error: "The provider returned an error (HTTP 500)" });
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(await processOneJob()).toBe(false); // not due yet

    await job!.update({ runAfter: new Date(Date.now() - 1000) });
    expect(await processOneJob()).toBe(true);
    job = await AiJob.findOne({ where: { id: jobId, orgId } });
    expect(job).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("fails a job at once when its owner lost the permission", async () => {
    await enableAi();
    const { auth, orgId, userId } = await login("Tenant", "t1", { actions: ["risk.update"] });
    const { jobId } = (await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a"] })).body.data;
    await User.update({ status: "Suspended" }, { where: { id: userId } });
    expect(await processOneJob()).toBe(true);
    expect(await AiJob.findOne({ where: { id: jobId, orgId } })).toMatchObject({ status: "failed", attempts: 1 });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("re-claims a job orphaned while running, and fails one with no attempts left", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1", { actions: ["risk.update"] });
    const queue = async () => (await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a"] })).body.data.jobId as string;
    const [spent, retryable] = [await queue(), await queue()];
    const staleAt = new Date(Date.now() - 16 * 60_000);
    await AiJob.update({ status: "running", attempts: MAX_ATTEMPTS, lockedAt: staleAt }, { where: { id: spent } });
    await AiJob.update({ status: "running", attempts: 1, lockedAt: staleAt }, { where: { id: retryable } });
    ai.complete.mockResolvedValueOnce(reply('{"title": "A"}'));

    expect(await processOneJob()).toBe(true);
    expect(await processOneJob()).toBe(false);
    expect(await AiJob.findOne({ where: { id: spent, orgId } })).toMatchObject({ status: "failed", error: ORPHANED_JOB_ERROR, lockedAt: null });
    expect(await AiJob.findOne({ where: { id: retryable, orgId } })).toMatchObject({ status: "done", attempts: 2 });
  });

  it("does not touch a running job whose lock is still fresh", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1", { actions: ["risk.update"] });
    const { jobId } = (await post(auth, "/v1/ai/features/test-batch/titles", { items: ["a"] })).body.data;
    await AiJob.update({ status: "running", attempts: MAX_ATTEMPTS, lockedAt: new Date() }, { where: { id: jobId } });
    expect(await processOneJob()).toBe(false);
    expect(await AiJob.findOne({ where: { id: jobId, orgId } })).toMatchObject({ status: "running" });
  });

  it("stores feedback on the caller's own generations only", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1");
    ai.complete.mockResolvedValueOnce(reply("s"));
    const { generationId } = (await post(auth, "/v1/ai/features/summarize/text", { text: "x" })).body.data;

    expect((await post(auth, `/v1/ai/generations/${generationId}/feedback`, { status: "bogus" })).status).toBe(400);
    const ok = await post(auth, `/v1/ai/generations/${generationId}/feedback`, { status: "edited" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ ok: true });
    expect((await AiGeneration.findOne({ where: { id: generationId, orgId } }))!.status).toBe("edited");

    const other = await login("Tenant", "t9", { orgCode: "OtherTenant" });
    expect((await post(other.auth, `/v1/ai/generations/${generationId}/feedback`, { status: "rejected" })).status).toBe(404);
  });

  it("reports usage per feature for the caller's org", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "t1", { actions: ["ai.settings.read"] });
    ai.complete.mockResolvedValue(reply("s"));
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await post(auth, "/v1/ai/features/summarize/text", { text: "x" })).body.data.generationId);
    await post(auth, `/v1/ai/generations/${ids[0]}/feedback`, { status: "accepted" });
    await post(auth, `/v1/ai/generations/${ids[1]}/feedback`, { status: "rejected" });

    const res = await get(auth, "/v1/ai/usage");
    expect(res.status).toBe(200);
    expect(res.body.data.orgId).toBe(orgId);
    expect(res.body.data.features).toEqual([
      { feature: "summarize", generations: 3, failed: 0, accepted: 1, edited: 0, rejected: 1, acceptRate: 0.5, inputTokens: 33, outputTokens: 21 },
    ]);
    expect((await get(auth, "/v1/ai/usage?from=2000-01-01&to=2000-01-31")).body.data.features).toEqual([]);
    expect((await get(auth, "/v1/ai/usage?from=2026-02-01&to=2026-01-01")).status).toBe(400);

    const so = await login("ServiceOwner", "so", { superAdmin: true });
    expect((await get(so.auth, `/v1/ai/usage?orgId=${orgId}`)).body.data.features[0].generations).toBe(3);
    expect((await get(auth, `/v1/ai/usage?orgId=${so.orgId}`)).status).toBe(403);
    const plain = await login("Tenant", "t2");
    expect((await get(plain.auth, "/v1/ai/usage")).status).toBe(403);
  });

  it("resolves flags: org override > platform default > enabled", async () => {
    const so = await login("ServiceOwner", "so", { superAdmin: true });
    const t = await login("Tenant", "t1");
    const flag = async (orgId?: string) => {
      const res = await get(so.auth, `/v1/ai/feature-flags${orgId ? `?orgId=${orgId}` : ""}`);
      return res.body.data.find((f: { feature: string }) => f.feature === "summarize");
    };
    expect(await flag(t.orgId)).toEqual({ feature: "summarize", enabled: true, source: "default" });

    await put(so.auth, "/v1/ai/feature-flags", { feature: "summarize", enabled: false });
    expect(await flag()).toEqual({ feature: "summarize", enabled: false, source: "platform" });
    expect(await flag(t.orgId)).toEqual({ feature: "summarize", enabled: false, source: "platform" });

    const res = await put(so.auth, "/v1/ai/feature-flags", { orgId: t.orgId, feature: "summarize", enabled: true });
    expect(res.status).toBe(200);
    expect(await flag(t.orgId)).toEqual({ feature: "summarize", enabled: true, source: "org" });
    expect((await get(t.auth, "/v1/ai/features")).body.data.features.find((f: { key: string }) => f.key === "summarize").enabled).toBe(true);

    await put(so.auth, "/v1/ai/feature-flags", { orgId: t.orgId, feature: "summarize", enabled: null });
    expect(await flag(t.orgId)).toEqual({ feature: "summarize", enabled: false, source: "platform" });
    expect(await AuditLog.count({ where: { action: "ai.feature_flag.updated" } })).toBe(3);

    expect((await put(so.auth, "/v1/ai/feature-flags", { feature: "nope", enabled: true })).status).toBe(404);
    expect((await get(t.auth, "/v1/ai/feature-flags")).status).toBe(403);
    const tenantAdmin = await login("Tenant", "t3", { actions: ["ai.settings.manage"] });
    expect((await put(tenantAdmin.auth, "/v1/ai/feature-flags", { feature: "summarize", enabled: true })).status).toBe(403);
  });

  it("runs due schedules once per interval", async () => {
    // Other registered features (deadline-agent) bring schedules of their own.
    expect(await runDueSchedules()).toContain("test-batch:tick");
    expect(await runDueSchedules()).not.toContain("test-batch:tick");
    expect(scheduleRuns).toHaveBeenCalledTimes(1);
  });

  it("a schedule that throws is not re-run until its next interval", async () => {
    scheduleRuns.mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Other registered features (deadline-agent) bring schedules of their own.
    expect(await runDueSchedules()).toContain("test-batch:tick");
    expect(await runDueSchedules()).not.toContain("test-batch:tick");
    expect(scheduleRuns).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
