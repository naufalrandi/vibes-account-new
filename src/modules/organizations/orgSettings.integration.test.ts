import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";

const app = createApp();

interface SeedOpts {
  superAdmin?: boolean;
  actions?: string[];
}

/**
 * Create a Service-Owner org with one user + role and return an access token plus
 * the org. `superAdmin` mints a super-admin role (bypasses action grants);
 * otherwise the given action keys are granted to a plain role.
 */
async function seedLogin(opts: SeedOpts = {}): Promise<{ token: string; org: Organization }> {
  const org = await Organization.create({
    name: "AXIA",
    code: "AXIA",
    type: "ServiceOwner",
    status: "Active",
    parentOrgId: null,
    tenantId: null,
    email: null,
    phone: null,
    website: null,
    country: null,
    address: "1 Marina Blvd",
    legalName: "AXIA Pte Ltd",
    industry: "Technology",
    contactName: "James Tan",
    contactEmail: "james@axia.io",
    contactPhone: "+65 9123 4567",
  });
  const user = await User.create({
    orgId: org.id,
    tenantId: null,
    fullName: "Admin",
    username: "soadmin",
    email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"),
    status: "Active",
    position: null,
    workUnit: null,
    lastLogin: null,
    activationToken: null,
    resetToken: null,
    resetExpires: null,
  });
  const role = await Role.create({
    name: opts.superAdmin ? "SO Administrator" : "Limited",
    tierScope: "ServiceOwner",
    orgId: org.id,
    isSuperAdmin: opts.superAdmin ?? false,
    status: true,
  });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  if (!opts.superAdmin && opts.actions?.length) await grantActions(role.id, opts.actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, org };
}

describe("org-settings", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("returns the caller's own organization settings", async () => {
    const { token, org } = await seedLogin({ superAdmin: true });
    const res = await request(app).get("/v1/org-settings").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: org.id,
      name: "AXIA",
      code: "AXIA",
      legalName: "AXIA Pte Ltd",
      industry: "Technology",
      address: "1 Marina Blvd",
      contactName: "James Tan",
      contactEmail: "james@axia.io",
      contactPhone: "+65 9123 4567",
    });
  });

  it("partially updates allowed fields and returns the updated org", async () => {
    const { token, org } = await seedLogin({ superAdmin: true });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ legalName: "AXIA Holdings Pte Ltd", contactEmail: "ops@axia.io" });
    expect(res.status).toBe(200);
    expect(res.body.data.legalName).toBe("AXIA Holdings Pte Ltd");
    expect(res.body.data.contactEmail).toBe("ops@axia.io");
    // Untouched fields are preserved.
    expect(res.body.data.name).toBe("AXIA");
    expect(res.body.data.industry).toBe("Technology");

    const reloaded = await Organization.findByPk(org.id);
    expect(reloaded?.legalName).toBe("AXIA Holdings Pte Ltd");
    expect(reloaded?.contactEmail).toBe("ops@axia.io");
  });

  it("round-trips branding + system defaults + identity fields (Phase 2)", async () => {
    const { token, org } = await seedLogin({ superAdmin: true });
    const branding = { logo: "https://cdn/logo.png", favicon: "https://cdn/fav.ico", primary: "#0A84FF", secondary: "#1C1C1E" };
    const defaults = { currency: "IDR", timezone: "Asia/Jakarta", country: "ID", language: "Bahasa Indonesia" };
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ taxId: "01.234.567.8-901.000", website: "https://axia.io", phone: "+65 6000 0000", country: "SG", branding, defaults });
    expect(res.status).toBe(200);
    expect(res.body.data.taxId).toBe("01.234.567.8-901.000");
    expect(res.body.data.website).toBe("https://axia.io");
    expect(res.body.data.country).toBe("SG");
    expect(res.body.data.branding).toEqual(branding);
    expect(res.body.data.defaults).toEqual(defaults);

    // Persisted + re-read on a fresh GET.
    const get = await request(app).get("/v1/org-settings").set("authorization", `Bearer ${token}`);
    expect(get.body.data.branding).toEqual(branding);
    expect(get.body.data.defaults).toEqual(defaults);

    const reloaded = await Organization.findByPk(org.id);
    expect(reloaded?.branding).toEqual(branding);
    expect(reloaded?.systemDefaults).toEqual(defaults);
  });

  it("updates the organization code when it is unique", async () => {
    const { token, org } = await seedLogin({ superAdmin: true });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "AXIA Renamed", code: "AXIA2" });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe("AXIA2");
    expect(res.body.data.name).toBe("AXIA Renamed");

    const reloaded = await Organization.findByPk(org.id);
    expect(reloaded?.code).toBe("AXIA2");
  });

  it("rejects changing the organization code to one already in use", async () => {
    const { token, org } = await seedLogin({ superAdmin: true });
    await Organization.create({
      name: "Globex",
      code: "GLBX",
      type: "Tenant",
      status: "Active",
      parentOrgId: null,
      tenantId: null,
      email: null,
      phone: null,
      website: null,
      country: null,
      address: null,
      legalName: null,
      industry: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ code: "GLBX" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CODE");

    const reloaded = await Organization.findByPk(org.id);
    expect(reloaded?.code).toBe("AXIA");
  });

  it("rejects an empty organization code", async () => {
    const { token } = await seedLogin({ superAdmin: true });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ code: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty organization name", async () => {
    const { token } = await seedLogin({ superAdmin: true });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid contact email", async () => {
    const { token } = await seedLogin({ superAdmin: true });
    const res = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unauthenticated access with 401", async () => {
    await seedLogin({ superAdmin: true });
    const getRes = await request(app).get("/v1/org-settings");
    expect(getRes.status).toBe(401);
    const patchRes = await request(app).patch("/v1/org-settings").send({ name: "X" });
    expect(patchRes.status).toBe(401);
  });

  it("rejects a role without the org.update grant with 403 on update", async () => {
    // Reader role: can read settings but not update them.
    const { token } = await seedLogin({ actions: ["org.read"] });
    const getRes = await request(app).get("/v1/org-settings").set("authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    const patchRes = await request(app)
      .patch("/v1/org-settings")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Nope" });
    expect(patchRes.status).toBe(403);
  });

  it("rejects a role without any org grants with 403 on read", async () => {
    const { token } = await seedLogin({ actions: [] });
    const res = await request(app).get("/v1/org-settings").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("scopes to the caller's org — a client cannot read another org via the endpoint", async () => {
    // The endpoint takes no id, so even a second org is invisible: the response is
    // always the caller's own organization, resolved from the auth context.
    const other = await Organization.create({
      name: "Globex",
      code: "GLBX",
      type: "Tenant",
      status: "Active",
      parentOrgId: null,
      tenantId: null,
      email: null,
      phone: null,
      website: null,
      country: null,
      address: null,
      legalName: null,
      industry: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    const { token, org } = await seedLogin({ superAdmin: true });
    const res = await request(app).get("/v1/org-settings").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(org.id);
    expect(res.body.data.id).not.toBe(other.id);
  });
});
