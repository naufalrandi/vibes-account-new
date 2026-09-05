import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RegistrationRequest } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";

const app = createApp();

async function makeAdmin(orgType: "ServiceOwner" | "Distributor", code: string, username: string, actionKeys: string[], parentOrgId: string | null = null) {
  const org = await Organization.create({
    name: code, code, type: orgType, status: "Active",
    parentOrgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: org.id, tenantId: null, fullName: `${code} admin`, username, email: `${username}@x.com`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  // Non-super-admin role granted exactly the given action keys (so we can test denials).
  const role = await Role.create({ name: `${code} Admin`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` is the
  // generic attribute setter and does NOT persist the association (matches user tests).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actionKeys);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

describe("registration workflow", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("distributor submits, SO approves → tenant + admin provisioned", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide"]);

    const submit = await request(app).post("/v1/registration-requests").set("authorization", `Bearer ${dist.token}`)
      .send({ name: "Acme", code: "ACME", adminFullName: "Acme Admin", adminUsername: "acmeadmin", adminEmail: "admin@acme.com" });
    expect(submit.status).toBe(201);
    const reqId = submit.body.data.id;

    const approve = await request(app).post(`/v1/registration-requests/${reqId}/approve`).set("authorization", `Bearer ${so.token}`);
    expect(approve.status).toBe(201);
    expect(approve.body.data.type).toBe("Tenant");

    const tenant = await Organization.findOne({ where: { code: "ACME" } });
    expect(tenant?.parentOrgId).toBe(dist.org.id);
    const admin = await User.findOne({ where: { username: "acmeadmin" } });
    expect(admin?.status).toBe("Pending Activation");
    const req = await RegistrationRequest.findByPk(reqId);
    expect(req?.status).toBe("Approved");
  });

  it("distributor cannot approve (decide permission required)", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const submit = await request(app).post("/v1/registration-requests").set("authorization", `Bearer ${dist.token}`)
      .send({ name: "Acme", code: "ACME", adminFullName: "A", adminUsername: "acmeadmin", adminEmail: "admin@acme.com" });
    const res = await request(app).post(`/v1/registration-requests/${submit.body.data.id}/approve`).set("authorization", `Bearer ${dist.token}`);
    expect(res.status).toBe(403);
  });

  it("lists registration requests for the SO, enriched with the distributor name", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide"]);
    await request(app).post("/v1/registration-requests").set("authorization", `Bearer ${dist.token}`)
      .send({ name: "Acme", code: "ACME", adminFullName: "A", adminUsername: "acmeadmin", adminEmail: "admin@acme.com" });

    const list = await request(app).get("/v1/registration-requests").set("authorization", `Bearer ${so.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      distributorOrgId: dist.org.id,
      distributorName: "NWP",
      status: "Submitted",
    });
    expect(list.body.data[0].proposedTenant.name).toBe("Acme");

    const approved = await request(app).get("/v1/registration-requests?status=Approved").set("authorization", `Bearer ${so.token}`);
    expect(approved.body.data).toHaveLength(0);
  });

  // OD's TREQ_STATUSES lifecycle: Draft → Submitted → Under Review → decision,
  // with Cancelled available before a decision is made.
  it("drafts, edits, submits and reviews a request", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide", "registration.submit"]);
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    const draft = await request(app).post("/v1/registration-requests").set(auth(dist.token))
      .send({ name: "Acme", code: "ACME", adminFullName: "A", adminUsername: "acmeadmin", adminEmail: "admin@acme.com", asDraft: true });
    expect(draft.body.data.status).toBe("Draft");
    const id = draft.body.data.id;

    // A draft is still editable.
    const edited = await request(app).put(`/v1/registration-requests/${id}`).set(auth(dist.token)).send({ name: "Acme Group" });
    expect(edited.body.data.proposedTenant.name).toBe("Acme Group");

    const submitted = await request(app).post(`/v1/registration-requests/${id}/transition`).set(auth(dist.token)).send({ status: "Submitted" });
    expect(submitted.body.data.status).toBe("Submitted");

    // Only the Service Owner takes a request under review.
    expect((await request(app).post(`/v1/registration-requests/${id}/transition`).set(auth(dist.token)).send({ status: "Under Review" })).status).toBe(403);
    const review = await request(app).post(`/v1/registration-requests/${id}/transition`).set(auth(so.token)).send({ status: "Under Review" });
    expect(review.body.data.status).toBe("Under Review");

    // A request under review can still be approved.
    // Approval provisions the tenant org, so it responds 201 Created.
    expect((await request(app).post(`/v1/registration-requests/${id}/approve`).set(auth(so.token))).status).toBe(201);
  });

  it("rejects an illegal transition and refuses to edit a decided request", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide", "registration.submit"]);
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    const submitted = await request(app).post("/v1/registration-requests").set(auth(dist.token))
      .send({ name: "Beta", code: "BETA", adminFullName: "B", adminUsername: "betaadmin", adminEmail: "admin@beta.com" });
    const id = submitted.body.data.id;

    // Already Submitted — cannot go back to Submitted.
    const bad = await request(app).post(`/v1/registration-requests/${id}/transition`).set(auth(dist.token)).send({ status: "Submitted" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_TRANSITION");

    await request(app).post(`/v1/registration-requests/${id}/reject`).set(auth(so.token)).send({ reason: "Duplicate" });
    const late = await request(app).put(`/v1/registration-requests/${id}`).set(auth(dist.token)).send({ name: "Beta 2" });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe("REQUEST_DECIDED");
  });

  it("lets the Service Owner raise a Direct request of its own", async () => {
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide", "registration.submit"]);
    const auth = { authorization: `Bearer ${so.token}` };

    const res = await request(app).post("/v1/registration-requests").set(auth)
      .send({ name: "Direct Co", code: "DIRECT", adminFullName: "D", adminUsername: "directadmin", adminEmail: "admin@direct.com" });
    expect(res.status).toBe(201);
    expect(res.body.data.submittedBy).toBe(so.org.id);

    const list = await request(app).get("/v1/registration-requests").set(auth);
    expect(list.body.data.map((r: { proposedTenant: { name: string } }) => r.proposedTenant.name)).toContain("Direct Co");
  });

  it("keeps a partner out of another partner's requests", async () => {
    const a = await makeAdmin("Distributor", "PA", "pa.admin", ["registration.submit"]);
    const b = await makeAdmin("Distributor", "PB", "pb.admin", ["registration.submit"]);
    const submitted = await request(app).post("/v1/registration-requests").set({ authorization: `Bearer ${a.token}` })
      .send({ name: "Gamma", code: "GAMMA", adminFullName: "G", adminUsername: "gammaadmin", adminEmail: "admin@gamma.com" });

    const res = await request(app).put(`/v1/registration-requests/${submitted.body.data.id}`)
      .set({ authorization: `Bearer ${b.token}` }).send({ name: "Hijack" });
    expect(res.status).toBe(403);
  });
});
