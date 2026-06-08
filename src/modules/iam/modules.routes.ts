import { Router, type Request, type Response, type NextFunction } from "express";
import { sendOk } from "../../lib/apiResponse";
import { requireAction } from "../../middleware/requireAction";
import { UnauthorizedError } from "../../lib/errors";
import { ACTIONS } from "./actions.catalog";
import { MODULES } from "./modules.catalog";

export const moduleRoutes = Router();

// The fixed module catalog for the permission grid. Read-only and static, but
// guarded so only authenticated team-managers can enumerate it.
moduleRoutes.get("/", requireAction(ACTIONS.MODULE_READ), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, MODULES, 200, { page: 1, limit: MODULES.length, total: MODULES.length });
  } catch (e) {
    next(e);
  }
});
