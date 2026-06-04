import { Router } from "express";
import * as c from "./framework.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkRoutes = Router();
frameworkRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_READ), c.list);
frameworkRoutes.get("/:id", requireAction(ACTIONS.FRAMEWORK_READ), c.get);
frameworkRoutes.post("/", requireAction(ACTIONS.FRAMEWORK_CREATE), c.create);
frameworkRoutes.put("/:id", requireAction(ACTIONS.FRAMEWORK_UPDATE), c.update);
frameworkRoutes.delete("/:id", requireAction(ACTIONS.FRAMEWORK_DELETE), c.remove);
