import { Router, type Request, type Response, type NextFunction } from "express";
import { sendOk } from "../../lib/apiResponse";
import { requireAction } from "../../middleware/requireAction";
import { UnauthorizedError } from "../../lib/errors";
import { ACTIONS } from "./actions.catalog";
import { MODULES, SP_SECTIONS } from "./modules.catalog";

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

// The Service Provider access map the member Access Configuration screen grants
// against — OD `acSections()` (js/core.js:4995) = `VIEWCFG().sp.sections`
// (js/core.js:2507-2548): nine sections, twenty-two grantable menu keys. A
// finer axis than MODULES above, which is the coarse module list derived from
// it (`acNavToModules`, js/core.js:5003-5006) for the permission grid.
moduleRoutes.get("/sp-sections", requireAction(ACTIONS.MODULE_READ), (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, SP_SECTIONS, 200, { page: 1, limit: SP_SECTIONS.length, total: SP_SECTIONS.length });
  } catch (e) {
    next(e);
  }
});
