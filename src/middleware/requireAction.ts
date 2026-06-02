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
