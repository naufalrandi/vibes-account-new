/**
 * AXI-42: server-side transition validation for the Inquiries business module
 * (`enterprise/ent-inq`), scoped via `prLifecycle.ts`'s `BUSINESS_TRANSITIONS`, plus
 * `inquiryRules.ts`'s service/variant/lifecycle allowlists and the AR (Application Review)
 * workflow's data-level state machine. A separate file from the PR/PO lifecycle tests and
 * `business.integration.test.ts` (not touched) so this runs in isolation, mirroring those
 * files' own stated rationale.
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

describe("Inquiry lifecycle (enterprise/ent-inq) — pipeline transitions + data validation + AR workflow", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function createLead(token: string) {
    return request(app).post("/v1/business/enterprise/ent-leads").set(authed(token)).send({
      title: "Nusa Prima Foods", status: "Qualifying", data: { company: "Nusa Prima Foods", country: "ID" },
    });
  }

  async function createInq(token: string, overrides: Record<string, unknown> = {}) {
    return request(app).post("/v1/business/enterprise/ent-inq").set(authed(token)).send({
      title: "Nusa Prima Foods — Framework Implementation",
      status: "Cold Leads",
      data: { service: "impl", variant: "Full Consultancy", lifecycle: "Open", ...overrides },
    });
  }

  function put(token: string, id: string, status: string, data: Record<string, unknown>) {
    return request(app).put(`/v1/business/enterprise/ent-inq/${id}`).set(authed(token)).send({ title: "Nusa Prima Foods — Framework Implementation", status, data });
  }

  it("creates an inquiry linked to a lead", async () => {
    const a = await actor("SP", "sp1", ALL);
    const lead = await createLead(a.token);
    const inq = await createInq(a.token, { leadId: lead.body.data.id });
    expect(inq.status).toBe(201);
    expect(inq.body.data.code).toMatch(/^INQ-\d+$/);
    expect(inq.body.data.data.leadId).toBe(lead.body.data.id);
  });

  it("accepts the first legal hop (Cold Leads → Potential)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token);
    const res = await put(a.token, created.body.data.id, "Potential", created.body.data.data);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Potential");
  });

  it("rejects skipping straight to Qualified (Cold Leads → Qualified)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token);
    const res = await put(a.token, created.body.data.id, "Qualified", created.body.data.data);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("walks the full pipeline Cold Leads → Potential → Qualified → Proposal Sent → Negotiation → Acquired", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token);
    const id = created.body.data.id;

    const s1 = await put(a.token, id, "Potential", created.body.data.data);
    expect(s1.status).toBe(200);
    const s2 = await put(a.token, id, "Qualified", s1.body.data.data);
    expect(s2.status).toBe(200);
    const s3 = await put(a.token, id, "Proposal Sent", s2.body.data.data);
    expect(s3.status).toBe(200);
    const s4 = await put(a.token, id, "Negotiation", s3.body.data.data);
    expect(s4.status).toBe(200);
    const s5 = await put(a.token, id, "Acquired", s4.body.data.data);
    expect(s5.status).toBe(200);
    expect(s5.body.data.status).toBe("Acquired");

    const illegal = await put(a.token, id, "Potential", s5.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("Lost is reachable from any non-terminal stage, and Lost can only reopen to Cold Leads", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token);
    const id = created.body.data.id;
    const potential = await put(a.token, id, "Potential", created.body.data.data);
    const lost = await put(a.token, id, "Lost", potential.body.data.data);
    expect(lost.status).toBe(200);
    expect(lost.body.data.status).toBe("Lost");

    const illegalFromLost = await put(a.token, id, "Qualified", lost.body.data.data);
    expect(illegalFromLost.status).toBe(400);

    const reopened = await put(a.token, id, "Cold Leads", lost.body.data.data);
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe("Cold Leads");
  });

  it("rejects any transition out of terminal Acquired", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token);
    const id = created.body.data.id;
    const p1 = await put(a.token, id, "Potential", created.body.data.data);
    const p2 = await put(a.token, id, "Qualified", p1.body.data.data);
    const p3 = await put(a.token, id, "Proposal Sent", p2.body.data.data);
    const p4 = await put(a.token, id, "Negotiation", p3.body.data.data);
    const acquired = await put(a.token, id, "Acquired", p4.body.data.data);
    expect(acquired.status).toBe(200);
    const illegal = await put(a.token, id, "Lost", acquired.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects an unknown service id (e.g. the out-of-scope 'cert')", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createInq(a.token, { service: "cert", variant: "Initial Certification" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SERVICE");
  });

  it("rejects a variant that doesn't belong to the given service", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createInq(a.token, { service: "impl", variant: "Initial Certification" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_VARIANT");
  });

  it("rejects an unknown lifecycle value", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createInq(a.token, { lifecycle: "Somewhere" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIFECYCLE");
  });

  it("out-of-scope lifecycle values from OD (Converted/AR Declined) are rejected — this issue's lifecycle is 4-state only", async () => {
    const a = await actor("SP", "sp1", ALL);
    const res = await createInq(a.token, { lifecycle: "Converted" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIFECYCLE");
  });

  it("Application Review workflow: Requested → Pending Manager → Approved persists at the data level", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token, { service: "audit", variant: "1st-party (internal)", lifecycle: "Open" });
    const id = created.body.data.id;

    const requested = await put(a.token, id, "Cold Leads", {
      ...created.body.data.data,
      lifecycle: "In Application Review",
      ar: { status: "Requested", standards: "ISO 9001:2015", sites: "1", personnel: "50" },
    });
    expect(requested.status).toBe(200);
    expect(requested.body.data.data.ar.status).toBe("Requested");
    expect(requested.body.data.data.lifecycle).toBe("In Application Review");

    const reviewed = await put(a.token, id, "Cold Leads", {
      ...requested.body.data.data,
      ar: { ...requested.body.data.data.ar, status: "Pending Manager", officer: "sp1 User" },
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.data.ar.status).toBe("Pending Manager");

    const approved = await put(a.token, id, "Cold Leads", {
      ...reviewed.body.data.data,
      lifecycle: "AR Approved",
      ar: { ...reviewed.body.data.data.ar, status: "Approved", manager: "sp1 User" },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.data.ar.status).toBe("Approved");
    expect(approved.body.data.data.lifecycle).toBe("AR Approved");
  });

  it("Application Review workflow: Declined sets ar.status and a reason", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createInq(a.token, { service: "assess", variant: "Maturity Assessment", lifecycle: "In Application Review", ar: { status: "Pending Manager" } });
    const id = created.body.data.id;

    const declined = await put(a.token, id, "Lost", {
      ...created.body.data.data,
      ar: { ...created.body.data.data.ar, status: "Declined", reason: "Out of scope competence" },
    });
    expect(declined.status).toBe(200);
    expect(declined.body.data.data.ar.status).toBe("Declined");
    expect(declined.body.data.data.ar.reason).toBe("Out of scope competence");
    expect(declined.body.data.status).toBe("Lost");
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
