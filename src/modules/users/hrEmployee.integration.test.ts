import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

/**
 * `GET /v1/hr-employees` — Team Management's "No access" roster (OD
 * `tmProvisioned`). The frontend has called this since the stat card was
 * written; nothing served it, so the card silently read 0.
 */
describe("GET /v1/hr-employees", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function setup() {
    const so = await Organization.create({
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const admin = await User.create({
      orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null, provisioned: true,
    });
    const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
    await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    return { token: login.body.data.accessToken as string, orgId: so.id };
  }

  it("returns only roster entries with no platform access", async () => {
    const { token, orgId } = await setup();
    await User.create({
      orgId, tenantId: null, fullName: "Kurt Wagner", username: "kurt.wagner", email: "kurt.wagner@axia.io",
      passwordHash: null, status: "Active", position: "Operations Coordinator", workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null, provisioned: false,
    });

    const res = await request(app).get("/v1/hr-employees").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // The provisioned admin must not appear — this is the no-access half of the
    // roster, and counting an account holder here overstates the card.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      fullName: "Kurt Wagner", email: "kurt.wagner@axia.io", role: "Operations Coordinator", provisioned: false,
    });
  });

  it("scopes to the requested organization", async () => {
    const { token, orgId } = await setup();
    const other = await Organization.create({
      name: "Other", code: "OTHER", type: "Distributor", status: "Active",
      parentOrgId: orgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    for (const [org, name, email] of [[orgId, "Ours", "ours@axia.io"], [other.id, "Theirs", "theirs@other.io"]] as const) {
      await User.create({
        orgId: org, tenantId: null, fullName: name, username: email.split("@")[0], email,
        passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
        activationToken: null, resetToken: null, resetExpires: null, provisioned: false,
      });
    }

    const res = await request(app).get(`/v1/hr-employees?orgId=${orgId}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(["Ours"]);
  });

  it("never lets a Distributor see another organization's roster", async () => {
    const { orgId: soId } = await setup();
    const dist = await Organization.create({
      name: "Northwind", code: "NWP", type: "Distributor", status: "Active",
      parentOrgId: soId, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    // One unprovisioned person in each org.
    await User.create({
      orgId: soId, tenantId: null, fullName: "SO Staff", username: "so.staff", email: "so.staff@axia.io",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null, provisioned: false,
    });
    await User.create({
      orgId: dist.id, tenantId: null, fullName: "Dist Staff", username: "dist.staff", email: "dist.staff@nwp.io",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null, provisioned: false,
    });
    const distAdmin = await User.create({
      orgId: dist.id, tenantId: null, fullName: "Dist Admin", username: "distadmin", email: "da@nwp.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null, provisioned: true,
    });
    const role = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
    await (distAdmin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    await grantActions(role.id, [ACTIONS.USER_READ]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "distadmin", password: "ChangeMe123" });
    const bearer = `Bearer ${login.body.data.accessToken}`;

    const own = await request(app).get("/v1/hr-employees").set("Authorization", bearer);
    expect(own.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(["Dist Staff"]);

    // `orgId` narrows within what the caller can already see — it must not be a
    // way to read another organization's roster.
    const other = await request(app).get(`/v1/hr-employees?orgId=${soId}`).set("Authorization", bearer);
    expect(other.body.data).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/hr-employees");
    expect(res.status).toBe(401);
  });
});
