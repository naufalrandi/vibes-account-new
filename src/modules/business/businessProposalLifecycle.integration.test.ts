/**
 * AXI-43: server-side transition validation + data validation/totals computation for the
 * Proposals business module (`enterprise/ent-proposals`), scoped via `prLifecycle.ts`'s
 * `BUSINESS_TRANSITIONS` and `proposalRules.ts`'s item/discount/tax validation. A separate file
 * from the PR/PO/Inquiry lifecycle tests and `business.integration.test.ts` (not touched),
 * mirroring those files' own stated rationale for running in isolation.
 */
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL = [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE];

async function actor(code: string, username: string, actions: string[]) {
  const org = await Organization.create({ name: code, code, type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: `${code} User`, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `${code} R`, tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

describe("Proposal lifecycle (enterprise/ent-proposals) — transitions + item/discount/tax validation + totals", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  function createProposal(token: string, overrides: Record<string, unknown> = {}) {
    return request(app).post("/v1/business/enterprise/ent-proposals").set(authed(token)).send({
      title: "Nusa Prima Foods — ISO 9001 Implementation",
      status: "Draft",
      data: {
        currency: "IDR",
        items: [{ description: "Consulting days", qty: 10, unitPrice: 1000000 }],
        discount: 0,
        taxPct: 11,
        ...overrides,
      },
    });
  }

  function put(token: string, id: string, status: string, data: Record<string, unknown>) {
    return request(app).put(`/v1/business/enterprise/ent-proposals/${id}`).set(authed(token)).send({ title: "Nusa Prima Foods — ISO 9001 Implementation", status, data });
  }

  it("creates a proposal with items and computes server-side totals", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token);
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^PRO-\d+$/);
    // sub = 10*1,000,000 = 10,000,000; tax = 10,000,000*0.11 = 1,100,000; total = 11,100,000
    expect(res.body.data.data.totals).toEqual({ sub: 10_000_000, discount: 0, tax: 1_100_000, total: 11_100_000 });
  });

  it("discards a client-supplied totals value and recomputes it server-side", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, { totals: { sub: 1, discount: 0, tax: 0, total: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.data.data.totals.total).toBe(11_100_000);
  });

  it("rejects an illegal transition (Draft → Submitted, skipping Pending SM)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const res = await put(a.token, created.body.data.id, "Submitted", created.body.data.data);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("walks the full legal chain Draft → Pending SM → Submitted → Sent → Accepted", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const id = created.body.data.id;

    const s1 = await put(a.token, id, "Pending SM", created.body.data.data);
    expect(s1.status).toBe(200);
    const s2 = await put(a.token, id, "Submitted", s1.body.data.data);
    expect(s2.status).toBe(200);
    const s3 = await put(a.token, id, "Sent", s2.body.data.data);
    expect(s3.status).toBe(200);
    const s4 = await put(a.token, id, "Accepted", s3.body.data.data);
    expect(s4.status).toBe(200);
    expect(s4.body.data.status).toBe("Accepted");

    const illegal = await put(a.token, id, "Draft", s4.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("Rejected is reachable from Submitted", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const id = created.body.data.id;
    const p1 = await put(a.token, id, "Pending SM", created.body.data.data);
    const p2 = await put(a.token, id, "Submitted", p1.body.data.data);
    const rejected = await put(a.token, id, "Rejected", p2.body.data.data);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("Rejected");
  });

  it("Rejected is reachable from Sent", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const id = created.body.data.id;
    const p1 = await put(a.token, id, "Pending SM", created.body.data.data);
    const p2 = await put(a.token, id, "Submitted", p1.body.data.data);
    const p3 = await put(a.token, id, "Sent", p2.body.data.data);
    const rejected = await put(a.token, id, "Rejected", p3.body.data.data);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("Rejected");
  });

  it("SM-return: Pending SM can move back to Draft", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const id = created.body.data.id;
    const pending = await put(a.token, id, "Pending SM", created.body.data.data);
    const returned = await put(a.token, id, "Draft", pending.body.data.data);
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe("Draft");
  });

  it("Draft can move straight to Sent (non-cert branch)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const res = await put(a.token, created.body.data.id, "Sent", created.body.data.data);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Sent");
  });

  it("rejects any transition out of terminal Accepted", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const sent = await put(a.token, created.body.data.id, "Sent", created.body.data.data);
    const accepted = await put(a.token, created.body.data.id, "Accepted", sent.body.data.data);
    expect(accepted.status).toBe(200);
    const illegal = await put(a.token, created.body.data.id, "Sent", accepted.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects an item with negative qty", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, { items: [{ description: "Bad item", qty: -1, unitPrice: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ITEM");
  });

  it("rejects an item with negative unit price", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, { items: [{ description: "Bad item", qty: 1, unitPrice: -5 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ITEM");
  });

  it("rejects an item missing a description", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, { items: [{ description: "", qty: 1, unitPrice: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ITEM");
  });

  it("discount greater than the subtotal floors tax and total at the after-discount value of 0", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, {
      items: [{ description: "Consulting days", qty: 1, unitPrice: 100 }],
      discount: 1000,
      taxPct: 11,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.data.totals).toEqual({ sub: 100, discount: 1000, tax: 0, total: 0 });
  });

  it("rejects a proposal missing currency", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createProposal(a.token, { currency: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CURRENCY_REQUIRED");
  });

  it("does not disturb the sibling ent-inq graph — Cold Leads → Qualified is still rejected there", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await request(app).post("/v1/business/enterprise/ent-inq").set(authed(a.token)).send({ title: "X", status: "Cold Leads", data: { service: "impl", variant: "Full Consultancy", lifecycle: "Open" } });
    const res = await request(app).put(`/v1/business/enterprise/ent-inq/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "X", status: "Qualified", data: created.body.data.data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});
