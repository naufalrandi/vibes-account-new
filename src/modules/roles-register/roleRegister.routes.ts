import { Router } from "express";
import * as c from "./roleRegister.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const roleRegisterRoutes = Router();

// Role templates
roleRegisterRoutes.get("/templates", requireAction(ACTIONS.ORGROLE_READ), c.listTemplates);

// Assignments
roleRegisterRoutes.get("/assignments", requireAction(ACTIONS.ORGROLE_READ), c.listAssignments);
