import { Router } from "express";
import * as c from "./frameworkType.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkTypeRoutes = Router();
frameworkTypeRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_TYPE_READ), c.list);
frameworkTypeRoutes.post("/", requireAction(ACTIONS.FRAMEWORK_TYPE_CREATE), c.create);
frameworkTypeRoutes.put("/:id", requireAction(ACTIONS.FRAMEWORK_TYPE_UPDATE), c.update);
frameworkTypeRoutes.delete("/:id", requireAction(ACTIONS.FRAMEWORK_TYPE_DELETE), c.remove);
