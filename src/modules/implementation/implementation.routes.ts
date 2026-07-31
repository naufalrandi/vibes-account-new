import { Router } from "express";
import * as c from "./implementation.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// One router serves every clause register; `:module` selects the register.
export const implementationRoutes = Router();
implementationRoutes.get("/:module", requireAction(ACTIONS.MS_READ), c.list);
implementationRoutes.post("/:module", requireAction(ACTIONS.MS_MANAGE), c.create);
implementationRoutes.post("/concerns/:id/route", requireAction(ACTIONS.MS_MANAGE), c.routeConcern);
implementationRoutes.put("/:module/:id", requireAction(ACTIONS.MS_MANAGE), c.update);
implementationRoutes.delete("/:module/:id", requireAction(ACTIONS.MS_MANAGE), c.remove);
