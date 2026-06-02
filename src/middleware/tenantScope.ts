import type { Request, Response, NextFunction } from "express";

/**
 * Tenant context is derived from the verified JWT (req.auth), never from a
 * client-set header. This middleware is a no-op guard that documents the
 * invariant and can be extended to set DB session vars when RLS is added.
 */
export function tenantScope(req: Request, _res: Response, next: NextFunction): void {
  // req.auth.tenantId / orgType are the authoritative scope. Services call
  // organizationScopeWhere(req.auth) / userScopeWhere(req.auth).
  next();
}
