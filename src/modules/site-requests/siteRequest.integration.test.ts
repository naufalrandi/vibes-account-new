import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL = [ACTIONS.SITE_REQUEST_READ, ACTIONS.SITE_REQUEST_CREATE, ACTIONS.SITE_REQUEST_DECIDE];

/** Create an org of the given type with a user holding the given grants; returns a token. */
async function actor(orgType: "ServiceOwner" | "Distributor" | "Tenant", code: string, username: string, actions: string[]) {
  const org = await Organization.create({ name: code, code, type: orgType, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  if (orgType === "Tenant") { org.tenantId = org.id; await org.save(); }
  const user = await User.create({ orgId: org.id, tenantId: orgType === "Tenant" ? org.id : null, fullName: `${code} User`, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `${code} R`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

/**
 * Certification-audit finding: deciding a site request (review/reject/approve/
 * provision) must be Service-Owner-only — OD lets only the SP touch these
 * transitions (index.html:7838-7841), and Approve/Provision apply the
 * request's `proposed` fields directly onto the tenant's site, so a
 * Tenant/Distributor able to decide its own request could bypass the
 * site-governance lockdown entirely. Fixed two ways: `SITE_REQUEST_DECIDE` was
 * added to `SP_ONLY_ACTIONS` (tenantGrants.ts) so it's no longer handed out by
 * `grantEverythingExceptSpOnly`, AND a defense-in-depth `assertServiceOwner`
 * guard was added directly in siteRequest.service.ts so an *explicitly*
 * granted non-SP actor is still blocked — mirrors the "even with the grant"
 * pattern used for ticket.manage (ticket.integration.test.ts) and kb.manage
 * (kb.integration.test.ts).
 */
describe("site requests — decide endpoints are Service-Owner-only", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("blocks a Tenant from review/reject/approve/provision even with siteRequest.decide explicitly granted, while a Service Owner succeeds", async () => {
    const tenant = await actor("Tenant", "TEN", "tenant.user", ALL);
    const so = await actor("ServiceOwner", "AXIA", "so.admin", ALL);

    const created = await request(app).post("/v1/site-requests").set(authed(tenant.token)).send({
      orgId: tenant.org.id,
      type: "Site Addition",
      proposed: { name: "New Branch", siteType: "Branch Office", country: "ID" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("Submitted");
    const id = created.body.data.id;

    // The Tenant holds SITE_REQUEST_DECIDE directly (passes the route-level
    // requireAction check) but is still rejected by the service-layer
    // assertServiceOwner guard — this is the certification-audit regression case.
    expect((await request(app).post(`/v1/site-requests/${id}/review`).set(authed(tenant.token))).status).toBe(403);
    expect((await request(app).post(`/v1/site-requests/${id}/reject`).set(authed(tenant.token))).status).toBe(403);
    expect((await request(app).post(`/v1/site-requests/${id}/approve`).set(authed(tenant.token))).status).toBe(403);
    expect((await request(app).post(`/v1/site-requests/${id}/provision`).set(authed(tenant.token))).status).toBe(403);

    // The request must be untouched — still Submitted, not provisioned.
    const stillSubmitted = await request(app).get(`/v1/site-requests/${id}`).set(authed(tenant.token));
    expect(stillSubmitted.body.data.status).toBe("Submitted");
    expect(stillSubmitted.body.data.provisioned).toBe(false);

    // The Service Owner is unaffected: review → approve → provision all succeed.
    const reviewed = await request(app).post(`/v1/site-requests/${id}/review`).set(authed(so.token));
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.status).toBe("Under Review");

    const approved = await request(app).post(`/v1/site-requests/${id}/approve`).set(authed(so.token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("Approved");

    const provisioned = await request(app).post(`/v1/site-requests/${id}/provision`).set(authed(so.token));
    expect(provisioned.status).toBe(200);
    expect(provisioned.body.data.provisioned).toBe(true);
    expect(provisioned.body.data.provisionedSiteId).toBeTruthy();
  });

  it("blocks a Distributor from rejecting a request too, even with siteRequest.decide explicitly granted", async () => {
    const dist = await actor("Distributor", "DIST", "dist.user", ALL);
    const tenant = await actor("Tenant", "TEN2", "tenant.user2", ALL);

    const created = await request(app).post("/v1/site-requests").set(authed(tenant.token)).send({
      orgId: tenant.org.id,
      type: "Site Addition",
      proposed: { name: "Second Branch", siteType: "Branch Office", country: "ID" },
    });
    const id = created.body.data.id;

    expect((await request(app).post(`/v1/site-requests/${id}/reject`).set(authed(dist.token))).status).toBe(403);

    const so = await actor("ServiceOwner", "AXIA2", "so.admin2", ALL);
    const rejected = await request(app).post(`/v1/site-requests/${id}/reject`).set(authed(so.token));
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("Rejected");
  });
});
