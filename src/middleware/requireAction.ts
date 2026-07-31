import type { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

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
