import { describe, expect, it } from "vitest";
import { ROLE_GROUPS, ROLES_BY_ORG_TYPE, isAllowedRoleForOrgType } from "./role.catalog";

describe("role.catalog", () => {
  it("is the OD ROLE_GROUPS enum verbatim and in order", () => {
    // js/core.js:111 — the only role-group enum in OD. Rendered as the Role Group
    // <select> options (js/core.js:5265); acInit falls back to 'Basic User' for an
    // unrecognised group (js/core.js:5082).
    expect([...ROLE_GROUPS]).toEqual([
      "Administrator", "Billing Manager", "Technical Support", "Basic User",
    ]);
  });

  it("offers the same four role groups for every organization type", () => {
    // OD has no per-tier role-group variant, so ServiceOwner, Distributor and
    // Tenant all draw from ROLE_GROUPS.
    expect(ROLES_BY_ORG_TYPE.ServiceOwner).toEqual([...ROLE_GROUPS]);
    expect(ROLES_BY_ORG_TYPE.Distributor).toEqual([...ROLE_GROUPS]);
    expect(ROLES_BY_ORG_TYPE.Tenant).toEqual([...ROLE_GROUPS]);
  });

  it("accepts a role that is in the org type's set", () => {
    expect(isAllowedRoleForOrgType("ServiceOwner", "Administrator")).toBe(true);
    expect(isAllowedRoleForOrgType("ServiceOwner", "Technical Support")).toBe(true);
    expect(isAllowedRoleForOrgType("Distributor", "Billing Manager")).toBe(true);
    expect(isAllowedRoleForOrgType("Distributor", "Basic User")).toBe(true);
    expect(isAllowedRoleForOrgType("Tenant", "Technical Support")).toBe(true);
    expect(isAllowedRoleForOrgType("Tenant", "Basic User")).toBe(true);
  });

  it("rejects a role that is not in the org type's set", () => {
    // 'Team Member' is not an OD role group for any tier.
    expect(isAllowedRoleForOrgType("ServiceOwner", "Team Member")).toBe(false);
    expect(isAllowedRoleForOrgType("Distributor", "Team Member")).toBe(false);
    expect(isAllowedRoleForOrgType("Tenant", "Team Member")).toBe(false);
    // Unknown / hidden system role.
    expect(isAllowedRoleForOrgType("ServiceOwner", "Super Admin")).toBe(false);
    expect(isAllowedRoleForOrgType("Tenant", "Nonexistent")).toBe(false);
  });
});
