import type { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import type { AuthContext } from "../lib/scope";
import { getUserRoleNames } from "../modules/iam/access.service";

/** Gate a route on a granted action key. A super-admin role bypasses all checks. */
export function requireAction(actionKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.isSuperAdmin) return next();
    if (!req.auth.actions.includes(actionKey)) {
      return next(new ForbiddenError(`Missing action grant: ${actionKey}`));
    }
    next();
  };
}

/**
 * Passes when the caller holds ANY of the listed grants. Used where one screen
 * serves two roles — e.g. the tenant-request queue, which both the partner who
 * raises requests and the Service Owner who decides them need to read.
 */
export function requireAnyAction(...actionKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.isSuperAdmin) return next();
    if (!actionKeys.some((key) => req.auth!.actions.includes(key))) {
      return next(new ForbiddenError(`Missing action grant: one of ${actionKeys.join(", ")}`));
    }
    next();
  };
}

/**
 * OD `canOrgMgmt()` (js/core.js:4242-4247) — who may see the outer-rail
 * "Organization Management" (default) tier. Applied by `effectiveSections()`
 * (js/core.js:4262, `.filter(s => allowOrg || s.tier !== 'default')`), so a
 * caller who fails it must not reach the default-tier screens at all.
 *
 *   viewMode 'sp'     → roleGroup ∈ ['Administrator','Billing Manager','Technical Support']
 *   viewMode 'tenant' → tenantRole === 'top'
 *   anything else     → allowed
 *
 * Server mapping: `viewMode` is the actor's organization type, and OD's tenant
 * role 'top' is 'Top Management', which core.js:21572 spells out as the Tenant
 * Administrator ("Switch to Top Management (Tenant Administrator)"). The SP arm
 * is what excludes the fourth role group, 'Basic User' (ROLE_GROUPS,
 * js/core.js:111) — the only SP group the list omits.
 */
export function canOrgMgmt(orgType: AuthContext["orgType"], roleNames: string[]): boolean {
  if (orgType === "ServiceOwner") {
    return roleNames.some((r) => ["Administrator", "Billing Manager", "Technical Support"].includes(r));
  }
  if (orgType === "Tenant") return roleNames.includes("Administrator");
  return true;
}

/**
 * Route guard for the default "Organization Management" tier. Role names are
 * read per-request rather than from the token, the same way `authenticate`
 * resolves effective access, so a revoked role takes effect immediately.
 */
export function requireOrgMgmt() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) return next(new UnauthorizedError());
      if (req.auth.isSuperAdmin) return next();
      const roleNames = await getUserRoleNames(req.auth.userId);
      if (!canOrgMgmt(req.auth.orgType, roleNames)) {
        return next(new ForbiddenError("Organization Management is restricted to the Administrator"));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
