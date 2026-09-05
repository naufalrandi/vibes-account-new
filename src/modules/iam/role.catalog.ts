import type { OrgType } from "../../db/models/organization.model";

/**
 * OD `ROLE_GROUPS` (js/core.js:111) — the Service Provider Team Management role
 * groups, verbatim and in order. Four, not three: the access screen's Role Group
 * select renders every member (js/core.js:5265) and `acInit` falls back to
 * 'Basic User' for an unrecognised group (js/core.js:5082), so 'Basic User' is a
 * real assignable group, not an absence of one. `acPreset('Basic User')` grants
 * it profile-only access (js/core.js:5001).
 */
export const ROLE_GROUPS = ["Administrator", "Billing Manager", "Technical Support", "Basic User"] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

// Canonical assignable roles per organization type. The hidden system "Super
// Admin" role is intentionally NOT listed here — it is ServiceOwner-only and is
// gated separately in assignRole via tierScope, never assigned by name through
// createUser's catalog validation.
export const ROLES_BY_ORG_TYPE: Record<OrgType, string[]> = {
  // Service Provider = OD ROLE_GROUPS above.
  ServiceOwner: [...ROLE_GROUPS],
  Distributor: ["Administrator", "Billing Manager", "Technical Support"],
  Tenant: ["Administrator", "Billing Manager", "Team Member"],
};

/** True when roleName is an assignable role for the given organization type. */
export function isAllowedRoleForOrgType(orgType: OrgType, roleName: string): boolean {
  return ROLES_BY_ORG_TYPE[orgType].includes(roleName);
}
