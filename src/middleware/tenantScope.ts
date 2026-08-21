import type { Request, Response, NextFunction } from "express";

/**
 * Tenant context is derived from the verified JWT (req.auth) in each service layer,
 * never from client headers. Note: this middleware is currently a no-op marker on route mounts;
 * all tenant scoping is enforced directly in individual service query filters.
 */
export function tenantScope(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
