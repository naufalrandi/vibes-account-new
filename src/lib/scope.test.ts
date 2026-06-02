import { describe, expect, it } from "vitest";
import { Op } from "sequelize";
import { organizationScopeWhere, userScopeWhere, type AuthContext } from "./scope";

const so: AuthContext = { userId: "1", orgId: "so", tenantId: null, orgType: "ServiceOwner", isSuperAdmin: false, actions: [] };
const dist: AuthContext = { userId: "2", orgId: "d1", tenantId: null, orgType: "Distributor", isSuperAdmin: false, actions: [] };
const tenant: AuthContext = { userId: "3", orgId: "t1", tenantId: "t1", orgType: "Tenant", isSuperAdmin: false, actions: [] };

describe("organizationScopeWhere", () => {
  it("SO sees all", () => expect(organizationScopeWhere(so)).toEqual({}));
  it("Distributor sees self + managed tenants", () =>
    expect(organizationScopeWhere(dist)).toEqual({ [Op.or]: [{ id: "d1" }, { parentOrgId: "d1" }] }));
  it("Tenant sees only itself", () => expect(organizationScopeWhere(tenant)).toEqual({ id: "t1" }));
});

describe("userScopeWhere", () => {
  it("SO sees all users", () => expect(userScopeWhere(so)).toEqual({}));
  it("Tenant sees only its own users", () => expect(userScopeWhere(tenant)).toEqual({ tenantId: "t1" }));
});
