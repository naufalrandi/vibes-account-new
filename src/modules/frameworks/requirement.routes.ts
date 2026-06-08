import { Router } from "express";
import * as c from "./requirement.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const requirementRoutes = Router();
requirementRoutes.get("/", requireAction(ACTIONS.REQUIREMENT_READ), c.list);
requirementRoutes.get("/:id", requireAction(ACTIONS.REQUIREMENT_READ), c.get);
requirementRoutes.post("/", requireAction(ACTIONS.REQUIREMENT_CREATE), c.create);
requirementRoutes.put("/:id", requireAction(ACTIONS.REQUIREMENT_UPDATE), c.update);
requirementRoutes.delete("/:id", requireAction(ACTIONS.REQUIREMENT_DELETE), c.remove);
