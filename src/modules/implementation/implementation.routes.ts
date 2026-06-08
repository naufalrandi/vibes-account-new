import { Router } from "express";
import * as c from "./implementation.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// All 8 Tenant Implementation registers share these routes, keyed by :module.
export const implementationRoutes = Router();
implementationRoutes.get("/:module", requireAction(ACTIONS.IMPLEMENTATION_READ), c.list);
implementationRoutes.get("/:module/:id", requireAction(ACTIONS.IMPLEMENTATION_READ), c.get);
implementationRoutes.post("/:module", requireAction(ACTIONS.IMPLEMENTATION_CREATE), c.create);
implementationRoutes.put("/:module/:id", requireAction(ACTIONS.IMPLEMENTATION_UPDATE), c.update);
implementationRoutes.delete("/:module/:id", requireAction(ACTIONS.IMPLEMENTATION_DELETE), c.remove);
