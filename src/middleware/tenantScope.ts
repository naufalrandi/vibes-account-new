import type { Request, Response, NextFunction } from "express";
import { getTenantAccess } from "../modules/saas/lifecycle.service";
import { ForbiddenError, LockedError } from "../lib/errors";

/**
 * Tenant data visibility (which rows a caller may see) is derived from the
 * verified JWT (req.auth) in each service layer's query filters, never from
 * client headers — that part is unchanged.
 *
 * This middleware enforces a different, cross-cutting concern: SaaS
 * subscription lifecycle access (G-75). OD expresses the rule as a body CSS
 * class (`ws-readonly` / `ws-locked`, app.html:10846 saasApplyGrace) applied
 * only to tenant-portal views (`/^tn-/`). A CSS class enforces nothing here —
 * a locked-out browser tab stops no HTTP client — so the rule is reproduced
 * at the layer that actually gates a request: this middleware, which the app
 * already threads through every authenticated route mount
 * (`authenticate, tenantScope, ...Routes` in app.ts). Only `orgType ===
 * "Tenant"` callers are ever gated, mirroring OD's tenant-only view test —
 * ServiceOwner/Distributor (SP/partner) staff manage tenants and must reach
 * a locked tenant's data regardless of that tenant's own lockout state.
 *
 * Access levels (see lifecycle.service.ts, 1:1 with OD's saasWsAccess):
 *  - full  (Active workspace)                     -> unrestricted
 *  - read  (Read-only workspace / subscription Grace 1) -> GET/HEAD/OPTIONS
 *          only; any other method is refused before it reaches a handler
 *  - none  (Locked/Archived/Failed/Provisioning)   -> every request refused,
 *          matching OD's full-page lockout ("Access to all modules is
 *          suspended")
 *
 * A tenant with no saas_workspaces row has never entered the SaaS pipeline —
 * true today for every pre-existing tenant — and keeps full access.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function tenantScope(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.auth || req.auth.orgType !== "Tenant" || !req.auth.tenantId) {
    next();
    return;
  }
  try {
    const { access } = await getTenantAccess(req.auth.tenantId);
    if (access === "full") {
      next();
      return;
    }
    if (access === "none") {
      next(
        new LockedError(
          "The subscription for this workspace has lapsed. Access to all modules is suspended until the subscription is renewed.",
        ),
      );
      return;
    }
    // access === "read"
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    next(
      new ForbiddenError(
        "This workspace subscription has lapsed and is in a grace period. You can view data but editing is disabled. Renew the subscription to restore full access.",
        "SUBSCRIPTION_READONLY",
      ),
    );
  } catch (err) {
    next(err);
  }
}
