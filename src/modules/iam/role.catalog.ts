import type { OrgType } from "../../db/models/organization.model";

// Canonical assignable roles per organization type. The hidden system "Super
// Admin" role is intentionally NOT listed here — it is ServiceOwner-only and is
// gated separately in assignRole via tierScope, never assigned by name through
// createUser's catalog validation.
export const ROLES_BY_ORG_TYPE: Record<OrgType, string[]> = {
  ServiceOwner: ["Administrator", "Billing Manager", "Technical Support"],
  Distributor: ["Administrator", "Billing Manager", "Technical Support"],
  Tenant: ["Administrator", "Billing Manager", "Team Member"],
};

/** True when roleName is an assignable role for the given organization type. */
export function isAllowedRoleForOrgType(orgType: OrgType, roleName: string): boolean {
  return ROLES_BY_ORG_TYPE[orgType].includes(roleName);
}
