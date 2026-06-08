import { Router } from "express";
import * as c from "./frameworkAssignment.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkAssignmentRoutes = Router();
frameworkAssignmentRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_ASSIGNMENT_READ), c.list);
frameworkAssignmentRoutes.get("/:id", requireAction(ACTIONS.FRAMEWORK_ASSIGNMENT_READ), c.get);
frameworkAssignmentRoutes.post("/", requireAction(ACTIONS.FRAMEWORK_ASSIGNMENT_CREATE), c.create);
frameworkAssignmentRoutes.put("/:id", requireAction(ACTIONS.FRAMEWORK_ASSIGNMENT_UPDATE), c.update);
frameworkAssignmentRoutes.delete("/:id", requireAction(ACTIONS.FRAMEWORK_ASSIGNMENT_DELETE), c.remove);
