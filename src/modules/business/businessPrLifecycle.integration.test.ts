/**
 * BE-5: server-side transition validation + activity-trail append for the
 * Purchase Requests business module (`enterprise/ent-pr`), scoped via
 * `prLifecycle.ts`'s `BUSINESS_TRANSITIONS`. A separate file from
 * `business.integration.test.ts` (not touched) so this can run in isolation
 * per the task brief.
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

describe("Purchase Request lifecycle (enterprise/ent-pr) — transition validation + activity trail", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function createPr(token: string, overrides: Record<string, unknown> = {}) {
    return request(app).post("/v1/business/enterprise/ent-pr").set(authed(token)).send({
      title: "Developer laptops", status: "Draft", data: { category: "Software", ...overrides },
    });
  }

  it("creating with no client-supplied activity gets a server-authored 'Record created' entry", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createPr(a.token);
    expect(res.status).toBe(201);
    expect(res.body.data.data.activity).toHaveLength(1);
    expect(res.body.data.data.activity[0]).toMatchObject({ action: "Record created" });
  });

  it("creating with client-supplied activity does not add a duplicate", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createPr(a.token, { activity: [{ ts: "2026-01-01T00:00:00.000Z", user: "Jane", action: "created Purchase Request", summary: "" }] });
    expect(res.status).toBe(201);
    expect(res.body.data.data.activity).toHaveLength(1);
    expect(res.body.data.data.activity[0]).toMatchObject({ action: "created Purchase Request" });
  });

  it("accepts a legal transition (Draft → Pending LM Review)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "Pending LM Review", data: created.body.data.data });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Pending LM Review");
  });

  it("rejects an illegal transition (Draft → Approved, skipping the whole workflow)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "Approved", data: created.body.data.data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects skipping a hop even toward a status the graph otherwise allows later (Draft → In Procurement)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "In Procurement", data: created.body.data.data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects any transition out of a terminal status (Completed), reached via a legal path", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const id = created.body.data.id;
    const put = (status: string, data: Record<string, unknown>) =>
      request(app).put(`/v1/business/enterprise/ent-pr/${id}`).set(authed(a.token)).send({ title: "Developer laptops", status, data });

    // Draft → Pending LM Review → In Procurement → Completed (the "fulfilled from stock" hop
    // in OD's `prIntakeReview`, app.html:31672 — a legal single hop straight from In Procurement).
    const step1 = await put("Pending LM Review", created.body.data.data);
    const step2 = await put("In Procurement", step1.body.data.data);
    const step3 = await put("Completed", step2.body.data.data);
    expect(step3.status).toBe(200);
    expect(step3.body.data.status).toBe("Completed");

    const illegal = await put("Cancelled", step3.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("re-saving the same status is always a no-op (not a transition)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops (edited)", status: "Draft", data: created.body.data.data });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Draft");
    // No status change → no server-authored fallback entry appended.
    expect(res.body.data.data.activity).toHaveLength(1);
  });

  it("appends a server-authored fallback activity entry when the client didn't extend the trail", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "Pending LM Review", data: created.body.data.data }); // same (single-entry) activity array passed through unchanged
    expect(res.status).toBe(200);
    expect(res.body.data.data.activity).toHaveLength(2);
    expect(res.body.data.data.activity[0]).toMatchObject({ action: "Status changed: Draft → Pending LM Review" });
  });

  it("does not duplicate when the client already appended its own activity entry for the transition", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createPr(a.token);
    const richActivity = [
      { ts: "2026-01-02T00:00:00.000Z", user: "Jane Requester", action: "submitted to Jennifer Susan Walters for review", summary: "" },
      ...created.body.data.data.activity,
    ];
    const res = await request(app).put(`/v1/business/enterprise/ent-pr/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Developer laptops", status: "Pending LM Review", data: { ...created.body.data.data, activity: richActivity } });
    expect(res.status).toBe(200);
    expect(res.body.data.data.activity).toHaveLength(2);
    // The client's own rich entry survives verbatim — no generic "Status changed: ..." entry added.
    expect(res.body.data.data.activity[0]).toMatchObject({ action: "submitted to Jennifer Susan Walters for review" });
  });

  it("a module with no registered transition graph (ent-suppliers) still accepts any status jump unconditionally", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await request(app).post("/v1/business/enterprise/ent-suppliers").set(authed(a.token)).send({ title: "Acme Supplies", status: "Pending Qualification" });
    const res = await request(app).put(`/v1/business/enterprise/ent-suppliers/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "Acme Supplies", status: "Rejected" }); // Approved -> Rejected style illegal-looking jump, still allowed for non-gated modules
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Rejected");
  });
});
