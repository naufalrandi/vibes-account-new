/**
 * D-2: server-side transition validation for the Purchase Orders business module
 * (`enterprise/ent-po`), scoped via `prLifecycle.ts`'s `BUSINESS_TRANSITIONS`. A separate file
 * from `businessPrLifecycle.integration.test.ts` (not touched) and `business.integration.test.ts`
 * (not touched) so this can run in isolation, mirroring that file's own stated rationale.
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

describe("Purchase Order lifecycle (enterprise/ent-po) — transition validation", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function createPo(token: string, overrides: Record<string, unknown> = {}) {
    return request(app).post("/v1/business/enterprise/ent-po").set(authed(token)).send({
      title: "Stark Industries Supply", status: "Issued", data: { prId: "pr-1", supplierName: "Stark Industries Supply", amount: 1000, ...overrides },
    });
  }

  function put(token: string, id: string, status: string, data: Record<string, unknown>) {
    return request(app).put(`/v1/business/enterprise/ent-po/${id}`).set(authed(token)).send({ title: "Stark Industries Supply", status, data });
  }

  it("accepts the first legal hop (Issued → Sent)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const res = await put(a.token, created.body.data.id, "Sent", created.body.data.data);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Sent");
  });

  it("rejects skipping straight to Confirmed (Issued → Confirmed)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const res = await put(a.token, created.body.data.id, "Confirmed", created.body.data.data);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("walks the full happy path Issued → Sent → Acknowledged → Confirmed → Received → Invoiced → Completed", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const id = created.body.data.id;

    const s1 = await put(a.token, id, "Sent", created.body.data.data);
    expect(s1.status).toBe(200);
    const s2 = await put(a.token, id, "Acknowledged", s1.body.data.data);
    expect(s2.status).toBe(200);
    const s3 = await put(a.token, id, "Confirmed", s2.body.data.data);
    expect(s3.status).toBe(200);
    const s4 = await put(a.token, id, "Received", s3.body.data.data);
    expect(s4.status).toBe(200);
    const s5 = await put(a.token, id, "Invoiced", s4.body.data.data);
    expect(s5.status).toBe(200);
    const s6 = await put(a.token, id, "Completed", s5.body.data.data);
    expect(s6.status).toBe(200);
    expect(s6.body.data.status).toBe("Completed");

    const illegal = await put(a.token, id, "Cancelled", s6.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("Sent can branch to Declined, and Declined can resend back to Sent", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const id = created.body.data.id;

    const sent = await put(a.token, id, "Sent", created.body.data.data);
    const declined = await put(a.token, id, "Declined", sent.body.data.data);
    expect(declined.status).toBe(200);
    expect(declined.body.data.status).toBe("Declined");

    const resent = await put(a.token, id, "Sent", declined.body.data.data);
    expect(resent.status).toBe(200);
    expect(resent.body.data.status).toBe("Sent");
  });

  it("rejects cancelling a Confirmed PO (no OD affordance to cancel past acknowledgement)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const id = created.body.data.id;

    const sent = await put(a.token, id, "Sent", created.body.data.data);
    const acked = await put(a.token, id, "Acknowledged", sent.body.data.data);
    const confirmed = await put(a.token, id, "Confirmed", acked.body.data.data);
    expect(confirmed.status).toBe(200);

    const illegal = await put(a.token, id, "Cancelled", confirmed.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("allows cancelling while still Issued/Sent/Acknowledged/Declined", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const res = await put(a.token, created.body.data.id, "Cancelled", created.body.data.data);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Cancelled");
  });

  it("rejects any transition out of a terminal status (Cancelled)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const cancelled = await put(a.token, created.body.data.id, "Cancelled", created.body.data.data);
    const illegal = await put(a.token, created.body.data.id, "Sent", cancelled.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("re-saving the same status is always a no-op (not a transition)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPo(a.token);
    const res = await put(a.token, created.body.data.id, "Issued", created.body.data.data);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Issued");
  });

  it("does not disturb the sibling ent-pr graph — Draft → Approved is still rejected there", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await request(app).post("/v1/business/enterprise/ent-pr").set(authed(a.token)).send({ title: "Developer laptops", status: "Draft", data: { category: "Software" } });
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "Approved", data: created.body.data.data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});
