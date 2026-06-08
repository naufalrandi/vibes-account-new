import { Router } from "express";
import * as c from "./criterion.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const criterionRoutes = Router();
criterionRoutes.get("/", requireAction(ACTIONS.CRITERION_READ), c.list);
criterionRoutes.post("/", requireAction(ACTIONS.CRITERION_MANAGE), c.create);
criterionRoutes.put("/:id", requireAction(ACTIONS.CRITERION_MANAGE), c.update);
criterionRoutes.delete("/:id", requireAction(ACTIONS.CRITERION_MANAGE), c.remove);
