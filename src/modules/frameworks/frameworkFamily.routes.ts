import { Router } from "express";
import * as c from "./frameworkFamily.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkFamilyRoutes = Router();
frameworkFamilyRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_FAMILY_READ), c.list);
frameworkFamilyRoutes.post("/", requireAction(ACTIONS.FRAMEWORK_FAMILY_CREATE), c.create);
frameworkFamilyRoutes.put("/:id", requireAction(ACTIONS.FRAMEWORK_FAMILY_UPDATE), c.update);
frameworkFamilyRoutes.delete("/:id", requireAction(ACTIONS.FRAMEWORK_FAMILY_DELETE), c.remove);
