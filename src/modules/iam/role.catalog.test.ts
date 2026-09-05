import { describe, expect, it } from "vitest";
import { ROLES_BY_ORG_TYPE, isAllowedRoleForOrgType } from "./role.catalog";

describe("role.catalog", () => {
  it("defines the canonical assignable roles for ServiceOwner", () => {
    // OD ROLE_GROUPS (js/core.js:111) has four members; the Access Configuration screen
    // renders all four (js/core.js:5265) and falls back to 'Basic User' (js/core.js:5082).
    expect(ROLES_BY_ORG_TYPE.ServiceOwner).toEqual([
      "Administrator", "Billing Manager", "Technical Support", "Basic User",
    ]);
  });

  it("defines the canonical assignable roles for Distributor", () => {
    expect(ROLES_BY_ORG_TYPE.Distributor).toEqual(["Administrator", "Billing Manager", "Technical Support"]);
  });

  it("defines the canonical assignable roles for Tenant", () => {
    expect(ROLES_BY_ORG_TYPE.Tenant).toEqual(["Administrator", "Billing Manager", "Team Member"]);
  });

  it("accepts a role that is in the org type's set", () => {
    expect(isAllowedRoleForOrgType("ServiceOwner", "Administrator")).toBe(true);
    expect(isAllowedRoleForOrgType("ServiceOwner", "Technical Support")).toBe(true);
    expect(isAllowedRoleForOrgType("Distributor", "Billing Manager")).toBe(true);
    expect(isAllowedRoleForOrgType("Tenant", "Team Member")).toBe(true);
  });

  it("rejects a role that is not in the org type's set", () => {
    // Team Member is Tenant-only, not valid for ServiceOwner/Distributor.
    expect(isAllowedRoleForOrgType("ServiceOwner", "Team Member")).toBe(false);
    expect(isAllowedRoleForOrgType("Distributor", "Team Member")).toBe(false);
    // Technical Support is not in the Tenant set.
    expect(isAllowedRoleForOrgType("Tenant", "Technical Support")).toBe(false);
    // Unknown / hidden system role.
    expect(isAllowedRoleForOrgType("ServiceOwner", "Super Admin")).toBe(false);
    expect(isAllowedRoleForOrgType("Tenant", "Nonexistent")).toBe(false);
  });
});
