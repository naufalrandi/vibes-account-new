import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiGeneration, BusinessRecord, Organization, Role, User } from "../../../db/models";
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

const post = (auth: string, path: string, body: object = {}) => request(app).post(path).set("authorization", auth).send(body);

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const BIZ = ["business.read", "business.manage"];
let seq = 0;
async function rec(orgId: string, module: string, title: string, data: Record<string, unknown>, company = "axia") {
  seq += 1;
  return BusinessRecord.create({ orgId, area: "enterprise", module, code: `T-${seq}`, title, status: "Open", owner: null, company, data });
}

const promptOf = (call = 0) => (ai.complete.mock.calls[call][0] as { messages: { content: string }[] }).messages[0].content;
const URL = "/v1/ai/features/procurement-assist";

async function prWithPo(orgId: string, prData: Record<string, unknown>, poData: Record<string, unknown> = {}) {
  const pr = await rec(orgId, "ent-pr", "Laptops", { currency: "IDR", qty: 2, duration: 1, estCost: 1_000_000, ...prData });
  const po = await rec(orgId, "ent-po", "Alpha", { prId: pr.id, amount: 1_000_000, supplierName: "Alpha", issuedDate: "2026-07-10", deliveryBy: "2026-07-20", currency: "IDR", ...poData });
  await pr.update({ data: { ...pr.data, poId: po.id } });
  return { pr, po };
}

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("procurement-assist feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("compare-quotes: figures come from the stored quotes; the model only picks and explains", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "p1", { actions: BIZ });
    const pr = await rec(orgId, "ent-pr", "Laptops", {
      currency: "IDR", estCost: 1_000_000,
      quotes: [
        { supplierId: "s-a", supplierName: "Alpha", amount: 950_000, leadTime: "8 weeks", docNumber: "Q1" },
        { supplierId: "s-b", supplierName: "Beta", amount: 990_000, leadTime: "1 week", docNumber: "Q2" },
      ],
    });
    ai.complete.mockResolvedValueOnce(reply({
      recommendedQuoteId: "s-b", selectReason: "Beta delivers 7 weeks sooner for 4% more.",
      quoteNotes: [{ quoteId: "s-a", assessment: "Cheapest but slow", risks: ["Misses need-by date"] }],
    }));
    const res = await post(auth, `${URL}/compare-quotes`, { prId: pr.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ recommendedQuoteId: "s-b", isLowest: false, selectReason: "Beta delivers 7 weeks sooner for 4% more." });
    expect(res.body.data.rows.map((r: { quoteId: string; amount: number }) => [r.quoteId, r.amount])).toEqual([["s-a", 950_000], ["s-b", 990_000]]);
    expect(res.body.data.rows[0].aiRisks).toEqual(["Misses need-by date"]);
    expect((await BusinessRecord.findByPk(pr.id))!.data).not.toHaveProperty("selectReason");
  });

  it("compare-quotes: an unknown recommendation is dropped and no quotes is a 400", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "p2", { actions: BIZ });
    const pr = await rec(orgId, "ent-pr", "PR", { quotes: [{ supplierId: "s-a", supplierName: "A", amount: 1 }] });
    ai.complete.mockResolvedValueOnce(reply({ recommendedQuoteId: "ghost", selectReason: "x", quoteNotes: [] }));
    expect((await post(auth, `${URL}/compare-quotes`, { prId: pr.id })).body.data.recommendedQuoteId).toBeNull();
    const empty = await rec(orgId, "ent-pr", "PR2", {});
    expect((await post(auth, `${URL}/compare-quotes`, { prId: empty.id })).status).toBe(400);
  });

  it("qc-note: drafts from observations (PII redacted), reachable by PO id", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "p3", { actions: BIZ });
    const { po } = await prWithPo(orgId, { description: "Laptops" });
    ai.complete.mockResolvedValueOnce({ text: "Two laptops inspected; one has a cracked hinge.", model: "m", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
    const res = await post(auth, `${URL}/qc-note`, { poId: po.id, observations: "1 cracked hinge, call 0812-3456-7890" });
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe("Two laptops inspected; one has a cracked hinge.");
    expect(promptOf()).not.toContain("0812-3456-7890");
    expect((await post(auth, `${URL}/qc-note`, { observations: "x" })).status).toBe(400);
    expect((await post(auth, `${URL}/qc-note`, { poId: po.id, observations: "x".repeat(4001) })).status).toBe(400);
  });

  it("three-way-check: skips the model when everything matches", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "p4", { actions: ["business.read"] });
    const { pr } = await prWithPo(orgId, {
      receipt: { id: "GRN-1", date: "2026-07-15", value: "1000000" },
      invoice: { number: "INV-1", amount: 1_005_000, date: "2026-07-16", supplierName: "Alpha" },
    });
    const res = await post(auth, `${URL}/three-way-check`, { prId: pr.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ match: true, discrepancies: [] });
    expect(res.body.data.explanation).toBeUndefined();
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("three-way-check: lists discrepancies and adds a model explanation", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "p5", { actions: BIZ });
    const { pr } = await prWithPo(orgId, {
      receipt: { id: "GRN-1", date: "2026-07-15", value: "1000000" },
      invoice: { number: "INV-1", amount: 1_200_000, date: "2026-07-16", supplierName: "Alpha" },
    });
    ai.complete.mockResolvedValueOnce({ text: "Invoice is 20% over the PO; request a credit note.", model: "m", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
    const res = await post(auth, `${URL}/three-way-check`, { prId: pr.id });
    expect(res.status).toBe(200);
    expect(res.body.data.match).toBe(false);
    expect(res.body.data.discrepancies.map((d: { code: string }) => d.code)).toEqual(["invoice_vs_po_amount", "invoice_vs_receipt_amount"]);
    expect(res.body.data.explanation).toBe("Invoice is 20% over the PO; request a credit note.");
    expect(res.body.data.generationId).toEqual(expect.any(String));
  });

  it("is scoped to the caller's org", async () => {
    await enableAi();
    const { auth } = await login("Tenant", "p6", { actions: BIZ });
    const other = await login("Tenant", "p7", { actions: BIZ, orgCode: "OTHER" });
    const { pr } = await prWithPo(other.orgId, {});
    expect((await post(auth, `${URL}/three-way-check`, { prId: pr.id })).status).toBe(404);
  });
});
