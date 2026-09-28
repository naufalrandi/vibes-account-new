import type { AuthContext } from "./scope";

/**
 * `tenantId` for an audit row about something in `orgId`, so a tenant's own
 * Audit Log shows it. A tenant caller is always acting in its own tenant; any
 * other caller reaching a *different* org got there through tenant scoping
 * (`visibleTenantOrgIds`), so that org is the tenant. A non-tenant acting on
 * its own org gets null.
 */
export function auditTenantId(auth: AuthContext, orgId: string | null | undefined): string | null {
  if (auth.orgType === "Tenant") return auth.tenantId ?? auth.orgId;
  return orgId && orgId !== auth.orgId ? orgId : null;
}
