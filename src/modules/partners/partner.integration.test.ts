import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RoleActionGrant, Action, AgreementTemplate, PartnerProfile } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions, seedActionCatalog } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Activate a PendingActivation user by its activation token and log in. */
async function activateAndLogin(username: string, token: string): Promise<string> {
  const activateRes = await request(app).post("/v1/auth/activate").send({ token, password: "NewPass123!" });
  expect(activateRes.status).toBe(200);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "NewPass123!" });
  expect(login.status).toBe(200);
  return login.body.data.accessToken as string;
}

/** Super-admin SO (bypasses action grants) — used for happy-path lifecycle flows. */
async function makeSo(superAdmin = true, actions: string[] = []): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: superAdmin, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function makeTemplate(token: string): Promise<string> {
  const res = await request(app).post("/v1/partnership-agreements").set(authed(token))
    .send({ name: "Reseller", version: "v2.1", blocks: [{ id: "b1", type: "paragraph", text: "Share {{revenue_share_percentage}}%" }] });
  return res.body.data.id;
}

describe("partners", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("forbids a role without partner grants", async () => {
    const { token } = await makeSo(false, []);
    const res = await request(app).get("/v1/partners").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("creates a draft partner with an auto PRT code + Distributor org + admin user", async () => {
    const { token } = await makeSo();
    const res = await request(app).post("/v1/partners").set(authed(token)).send({
      name: "Nusantara Cloud", email: "partners@nusantara.cloud", country: "ID", tier: "Gold",
      admin: { fullName: "Andi Wijaya", username: "andi.admin", email: "andi@nusantara.cloud" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^PRT-\d+$/);
    expect(res.body.data.status).toBe("Draft");
    expect(res.body.data.tier).toBe("Gold");
    expect(res.body.data.tenantCount).toBe(0);
    expect(res.body.data.audit[0].msg).toMatch(/created/i);

    // A Distributor org + a PendingActivation admin user were provisioned.
    const org = await Organization.findByPk(res.body.data.id);
    expect(org?.type).toBe("Distributor");
    const admin = await User.findOne({ where: { username: "andi.admin" } });
    expect(admin?.status).toBe("PendingActivation");
  });

  it("runs the full lifecycle: generate → approve → activate → suspend → resume → terminate", async () => {
    const { token } = await makeSo();
    const templateId = await makeTemplate(token);
    const created = await request(app).post("/v1/partners").set(authed(token)).send({
      name: "P", admin: { fullName: "A", username: "a.admin", email: "a@p.io" },
    });
    const id = created.body.data.id;

    // Illegal: cannot activate a Draft partner.
    const earlyActivate = await request(app).post(`/v1/partners/${id}/activate`).set(authed(token));
    expect(earlyActivate.status).toBe(409);

    // Generate the agreement → partner + agreement go Pending Approval.
    const gen = await request(app).post(`/v1/partners/${id}/agreement/generate`).set(authed(token))
      .send({ templateId, vars: { revenue_share_percentage: "20" } });
    expect(gen.status).toBe(201);
    expect(gen.body.data.number).toMatch(/^AGR-\d{4}-\d{4}$/);
    expect(gen.body.data.status).toBe("Pending Approval");
    expect(gen.body.data.renderedBlocks[0].text).toBe("Share 20%");
    let partner = await request(app).get(`/v1/partners/${id}`).set(authed(token));
    expect(partner.body.data.status).toBe("Pending Approval");

    // Resend (still pending), then approve.
    const resend = await request(app).post(`/v1/partners/${id}/agreement/resend`).set(authed(token));
    expect(resend.status).toBe(200);
    const approve = await request(app).post(`/v1/partners/${id}/agreement/approve`).set(authed(token));
    expect(approve.body.data.status).toBe("Approved");
    expect(approve.body.data.effectiveDate).toBeTruthy();
    partner = await request(app).get(`/v1/partners/${id}`).set(authed(token));
    expect(partner.body.data.status).toBe("Approved");

    // Activate → Active, Suspend → Suspended, Resume → Active.
    expect((await request(app).post(`/v1/partners/${id}/activate`).set(authed(token))).body.data.status).toBe("Active");
    expect((await request(app).post(`/v1/partners/${id}/suspend`).set(authed(token))).body.data.status).toBe("Suspended");
    expect((await request(app).post(`/v1/partners/${id}/resume`).set(authed(token))).body.data.status).toBe("Active");

    // Terminate → Terminated, and the agreement terminates too.
    const term = await request(app).post(`/v1/partners/${id}/terminate`).set(authed(token));
    expect(term.body.data.status).toBe("Terminated");
    const ag = await request(app).get(`/v1/partners/${id}/agreement`).set(authed(token));
    expect(ag.body.data.status).toBe("Terminated");

    // Suspending a terminated partner is illegal.
    expect((await request(app).post(`/v1/partners/${id}/suspend`).set(authed(token))).status).toBe(409);
  });

  it("creates a partner in send mode and generates the agreement atomically", async () => {
    const { token } = await makeSo();
    const templateId = await makeTemplate(token);
    const res = await request(app).post("/v1/partners").set(authed(token)).send({
      name: "SendCo", mode: "send", agreement: { templateId, vars: { revenue_share_percentage: "15" } },
      admin: { fullName: "B", username: "b.admin", email: "b@s.io" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Pending Approval");
    const ag = await request(app).get(`/v1/partners/${res.body.data.id}/agreement`).set(authed(token));
    expect(ag.body.data.number).toMatch(/^AGR-/);
  });

  it("scopes partners — a Distributor sees only itself, not sibling partners", async () => {
    const { token: soToken } = await makeSo();
    // Two partners created by the SO.
    const a = await request(app).post("/v1/partners").set(authed(soToken)).send({ name: "Alpha", admin: { fullName: "A", username: "alpha.admin", email: "a@a.io" } });
    await request(app).post("/v1/partners").set(authed(soToken)).send({ name: "Beta", admin: { fullName: "B", username: "beta.admin", email: "b@b.io" } });

    // SO sees both.
    const soList = await request(app).get("/v1/partners").set(authed(soToken));
    expect(soList.body.data).toHaveLength(2);

    // Give partner Alpha an active admin user with partner.read, then log in.
    const role = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: a.body.data.id, isSuperAdmin: false, status: true });
    await grantActions(role.id, [ACTIONS.PARTNER_READ]);
    const distUser = await User.create({
      orgId: a.body.data.id, tenantId: null, fullName: "Alpha Admin", username: "alpha.active", email: "active@a.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    await (distUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "alpha.active", password: "ChangeMe123" });
    const distToken = login.body.data.accessToken;

    const distList = await request(app).get("/v1/partners").set(authed(distToken));
    expect(distList.body.data).toHaveLength(1);
    expect(distList.body.data[0].name).toBe("Alpha");
    // And it cannot read a sibling partner directly.
    const others = await PartnerProfile.findAll();
    const betaOrgId = others.map((p) => p.orgId).find((oid) => oid !== a.body.data.id)!;
    const forbidden = await request(app).get(`/v1/partners/${betaOrgId}`).set(authed(distToken));
    expect(forbidden.status).toBe(403);
  });

  /**
   * Certification audit finding: `createPartner` used to create the Distributor
   * org + PendingActivation admin user with NO Role at all, so once the admin
   * activated their account every authorized request 403d (zero action
   * grants) — the same defect class already fixed for tenant provisioning
   * (see tenantGrants.integration.test.ts). Fixed by creating a real
   * "Administrator" Role (tierScope "Distributor") and calling
   * `grantEverythingExceptSpOnly` + `setRoles([role])`, mirroring
   * tenant.service.ts's `provisionTenant`.
   */
  it("createPartner provisions the new admin with a real Role + the curated non-SP grant set", async () => {
    // `grantEverythingExceptSpOnly` iterates the Action table, so the assertions
    // below need the real catalog present — `grantActions` only creates the keys
    // it is explicitly asked for. Without this the granted set is empty and the
    // test fails even though the product code is correct.
    await seedActionCatalog();
    const { token: soToken } = await makeSo();
    const res = await request(app).post("/v1/partners").set(authed(soToken)).send({
      name: "Borneo Digital", admin: { fullName: "Budi Santoso", username: "budi.admin", email: "budi@borneo.io" },
    });
    expect(res.status).toBe(201);
    const orgId = res.body.data.id;

    const role = await Role.findOne({ where: { orgId, name: "Administrator" } });
    expect(role).not.toBeNull();
    expect(role!.tierScope).toBe("Distributor");

    // Curated set: a representative granted action + a representative SP-only
    // action that must NOT be granted (mirrors SP_ONLY_ACTIONS in tenantGrants.ts).
    const grants = await RoleActionGrant.findAll({ where: { roleId: role!.id }, include: [Action] });
    const grantedKeys = new Set(grants.map((g) => (g.get("Action") as Action).key));
    expect(grantedKeys.has(ACTIONS.SITE_READ)).toBe(true);
    expect(grantedKeys.has(ACTIONS.MS_READ)).toBe(true);
    expect(grantedKeys.has(ACTIONS.FRAMEWORK_CREATE)).toBe(false);

    // Activate the admin (the notification send is a stub in tests — pull the
    // token straight from the row) and confirm the grants are real end-to-end.
    const admin = await User.findOne({ where: { username: "budi.admin" } });
    expect(admin).not.toBeNull();
    const adminToken = await activateAndLogin("budi.admin", admin!.activationToken!);

    // Curated read within the new org succeeds…
    const siteList = await request(app).get("/v1/sites").set(authed(adminToken));
    expect(siteList.status).toBe(200);
    // …but an SP-only action is still forbidden (defense-in-depth: the route
    // itself rejects it even though the FE never renders the control).
    const frameworkCreate = await request(app)
      .post("/v1/frameworks")
      .set(authed(adminToken))
      .send({ name: "Should be rejected" });
    expect(frameworkCreate.status).toBe(403);
  });
});
