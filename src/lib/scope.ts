import { Op, type WhereOptions } from "sequelize";

export interface AuthContext {
  userId: string;
  orgId: string;
  tenantId: string | null;
  orgType: "ServiceOwner" | "Distributor" | "Tenant";
  isSuperAdmin: boolean;
  actions: string[]; // effective granted action keys (union across roles)
}

/** WHERE clause restricting Organization visibility to the actor's scope. */
export function organizationScopeWhere(auth: AuthContext): WhereOptions {
  switch (auth.orgType) {
    case "ServiceOwner":
      return {};
    case "Distributor":
      return { [Op.or]: [{ id: auth.orgId }, { parentOrgId: auth.orgId }] };
    case "Tenant":
      return { id: auth.orgId };
  }
}

/** WHERE clause restricting User visibility to the actor's scope. */
export function userScopeWhere(auth: AuthContext): WhereOptions {
  switch (auth.orgType) {
    case "ServiceOwner":
      return {};
    case "Distributor":
      // Distributor sees users of its tenants and of itself.
      return { [Op.or]: [{ orgId: auth.orgId }, { "$Organization.parent_org_id$": auth.orgId }] };
    case "Tenant":
      return { tenantId: auth.tenantId };
  }
}

/** True when the actor may act on a target organization id within its scope. */
export function canActOnOrg(auth: AuthContext, targetOrgId: string, targetParentOrgId: string | null): boolean {
  if (auth.orgType === "ServiceOwner") return true;
  if (auth.orgType === "Distributor") return targetOrgId === auth.orgId || targetParentOrgId === auth.orgId;
  return targetOrgId === auth.orgId;
}
