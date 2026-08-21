import { Router } from "express";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";
import * as controller from "./israSupport.controller";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const manage = requireAction(ACTIONS.ISRA_LIBRARY_MANAGE);

export const israSupportRoutes = Router();

israSupportRoutes.get("/settings", read, controller.getOrgSettings);
israSupportRoutes.put("/settings", manage, controller.saveOrgSettings);
israSupportRoutes.get("/appetite-log", read, controller.getAppetiteLog);
israSupportRoutes.post("/appetite-log", manage, controller.logAppetite);
israSupportRoutes.get("/diagnostics", read, controller.validateIntegrity);
