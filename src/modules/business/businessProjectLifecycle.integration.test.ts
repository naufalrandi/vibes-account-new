/**
 * AXI-44: server-enforced Proposal → Project conversion + Project delivery-lifecycle transitions
 * for the Projects business module (`enterprise/ent-projects`), scoped via `prLifecycle.ts`'s
 * `PROJECT_TRANSITIONS` and `business.service.ts`'s `createProjectFromProposal`. A separate file
 * from the PR/PO/Inquiry/Proposal lifecycle tests and `business.integration.test.ts` (not
 * touched), mirroring those files' own stated rationale for running in isolation.
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

describe("Project lifecycle (enterprise/ent-projects) — proposal conversion + delivery transitions", () => {
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
        leadId: "LD-2001",
        leadName: "Nusa Prima Foods",
        service: "impl",
        variant: "Full Consultancy",
        ...overrides,
      },
    });
  }

  async function acceptedProposal(token: string) {
    const created = await createProposal(token);
    const id = created.body.data.id;
    const sent = await request(app).put(`/v1/business/enterprise/ent-proposals/${id}`).set(authed(token)).send({ title: "Nusa Prima Foods — ISO 9001 Implementation", status: "Sent", data: created.body.data.data });
    const accepted = await request(app).put(`/v1/business/enterprise/ent-proposals/${id}`).set(authed(token)).send({ title: "Nusa Prima Foods — ISO 9001 Implementation", status: "Accepted", data: sent.body.data.data });
    return accepted.body.data;
  }

  function convert(token: string, proposalId: string, body: Record<string, unknown> = {}) {
    return request(app).post(`/v1/business/enterprise/ent-projects/from-proposal/${proposalId}`).set(authed(token)).send(body);
  }

  function put(token: string, id: string, status: string, data: Record<string, unknown>) {
    return request(app).put(`/v1/business/enterprise/ent-projects/${id}`).set(authed(token)).send({ title: "Nusa Prima Foods — ISO 9001 Implementation", status, data });
  }

  it("rejects converting a proposal that is not Accepted", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const res = await convert(a.token, created.body.data.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROPOSAL_NOT_ACCEPTED");
  });

  it("converts an Accepted proposal into a Planned project, deriving its fields server-side", async () => {
    const a = await actor("SP", "sp1", ALL);
    const proposal = await acceptedProposal(a.token);
    const res = await convert(a.token, proposal.id);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Planned");
    expect(res.body.data.code).toMatch(/^PRJ-\d+$/);
    expect(res.body.data.data).toMatchObject({
      proposalId: proposal.id,
      proposalCode: proposal.code,
      leadId: "LD-2001",
      leadName: "Nusa Prima Foods",
      service: "impl",
      variant: "Full Consultancy",
      currency: "IDR",
      totalValue: proposal.data.totals.total,
    });

    // stamps the proposal with the new project's id
    const back = await request(app).get(`/v1/business/enterprise/ent-proposals`).set(authed(a.token));
    const updated = back.body.data.find((p: { id: string }) => p.id === proposal.id);
    expect(updated.data.projectId).toBe(res.body.data.id);
  });

  it("a client cannot spoof leadId/service/currency/totalValue via the request body", async () => {
    const a = await actor("SP", "sp1", ALL);
    const proposal = await acceptedProposal(a.token);
    const res = await convert(a.token, proposal.id, { data: { leadId: "SPOOFED", service: "cert", currency: "USD", totalValue: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.data.data.leadId).toBe("LD-2001");
    expect(res.body.data.data.service).toBe("impl");
    expect(res.body.data.data.currency).toBe("IDR");
    expect(res.body.data.data.totalValue).toBe(proposal.data.totals.total);
  });

  it("rejects a second conversion of the same proposal", async () => {
    const a = await actor("SP", "sp1", ALL);
    const proposal = await acceptedProposal(a.token);
    const first = await convert(a.token, proposal.id);
    expect(first.status).toBe(201);
    const second = await convert(a.token, proposal.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PROJECT_ALREADY_EXISTS");
  });

  it("walks the full legal delivery chain Planned → Active → Delivered → Closed", async () => {
    const a = await actor("SP", "sp1", ALL);
    const proposal = await acceptedProposal(a.token);
    const created = await convert(a.token, proposal.id);
    const id = created.body.data.id;

    const s1 = await put(a.token, id, "Active", created.body.data.data);
    expect(s1.status).toBe(200);
    const s2 = await put(a.token, id, "Delivered", s1.body.data.data);
    expect(s2.status).toBe(200);
    const s3 = await put(a.token, id, "Closed", s2.body.data.data);
    expect(s3.status).toBe(200);
    expect(s3.body.data.status).toBe("Closed");

    const illegal = await put(a.token, id, "Active", s3.body.data.data);
    expect(illegal.status).toBe(400);
    expect(illegal.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("rejects skipping a stage (Planned → Delivered)", async () => {
    const a = await actor("SP", "sp1", ALL);
    const proposal = await acceptedProposal(a.token);
    const created = await convert(a.token, proposal.id);
    const res = await put(a.token, created.body.data.id, "Delivered", created.body.data.data);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("does not disturb the sibling ent-proposals graph — Draft → Submitted is still rejected there", async () => {
    const a = await actor("SP", "sp1", ALL);
    const created = await createProposal(a.token);
    const res = await request(app).put(`/v1/business/enterprise/ent-proposals/${created.body.data.id}`).set(authed(a.token))
      .send({ title: "X", status: "Submitted", data: created.body.data.data });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});
