import { Router } from "express";
import * as c from "./roleRegister.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const roleRegisterRoutes = Router();

// Role templates
roleRegisterRoutes.get("/templates", requireAction(ACTIONS.ORGROLE_READ), c.listTemplates);
roleRegisterRoutes.post("/templates", requireAction(ACTIONS.ORGROLE_MANAGE), c.createTemplate);
roleRegisterRoutes.put("/templates/:id", requireAction(ACTIONS.ORGROLE_MANAGE), c.updateTemplate);
roleRegisterRoutes.post("/templates/:id/archive", requireAction(ACTIONS.ORGROLE_MANAGE), c.archiveTemplate);

// Assignments
roleRegisterRoutes.get("/assignments", requireAction(ACTIONS.ORGROLE_READ), c.listAssignments);
roleRegisterRoutes.post("/assignments", requireAction(ACTIONS.ORGROLE_MANAGE), c.assign);
roleRegisterRoutes.put("/assignments/:id", requireAction(ACTIONS.ORGROLE_MANAGE), c.updateAssignment);
roleRegisterRoutes.post("/assignments/:id/archive", requireAction(ACTIONS.ORGROLE_MANAGE), c.archiveAssignment);
