import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { writeAudit } from "./audit.service";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const setRoles = (u: User, roles: Role[]) =>
  (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles(roles);

describe("audit", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("records a login and exposes it in the audit trail", async () => {
    const so = await Organization.create({
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const admin = await User.create({
      orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
    // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` only
    // sets an in-memory data value and never persists the join row.
    await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);

    const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    const res = await request(app).get("/v1/audit").set("authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { action: string }) => a.action === "auth.login.succeeded")).toBe(true);
  });

  it("does not let a Distributor widen audit visibility via ?orgId", async () => {
    const so = await Organization.create({
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    // A foreign tenant parented by the SO directly — NOT by this distributor.
    const foreign = await Organization.create({
      name: "Foreign", code: "FRN", type: "Tenant", status: "Active",
      parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    await foreign.update({ tenantId: foreign.id });
    const dist = await Organization.create({
      name: "NW", code: "NW", type: "Distributor", status: "Active",
      parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const u = await User.create({
      orgId: dist.id, tenantId: null, fullName: "D", username: "duser", email: "d@nw.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Dist Admin", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
    await setRoles(u, [role]);
    await grantActions(role.id, [ACTIONS.AUDIT_READ]);

    // A log that belongs only to the foreign tenant.
    await writeAudit({ actorUserId: u.id, organizationId: foreign.id, tenantId: foreign.id, action: "secret.foreign.event", entityType: "Organization", entityId: foreign.id, sourceIp: null, result: "Success" });

    const login = await request(app).post("/v1/auth/login").send({ identifier: "duser", password: "ChangeMe123" });
    const res = await request(app).get(`/v1/audit?orgId=${foreign.id}`).set("authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    // The ?orgId drill-down must be ignored (foreign is not parented by dist), so
    // the distributor sees none of the foreign tenant's logs.
    expect(res.body.data.some((a: { organizationId: string }) => a.organizationId === foreign.id)).toBe(false);
  });
});
