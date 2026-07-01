import { Router } from "express";
import * as c from "./internalAudit.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.IAUDIT_READ);
const manage = requireAction(ACTIONS.IAUDIT_MANAGE);

export const internalAuditRoutes = Router();

// Settings
internalAuditRoutes.get("/settings", read, c.getSettings);
internalAuditRoutes.put("/settings", manage, c.updateSettings);

// Programs
internalAuditRoutes.get("/programs", read, c.listPrograms);
internalAuditRoutes.post("/programs", manage, c.createProgram);
internalAuditRoutes.put("/programs/:id", manage, c.updateProgram);
internalAuditRoutes.post("/programs/:id/status", manage, c.setProgramStatus);

// Plans
internalAuditRoutes.get("/plans", read, c.listPlans);
internalAuditRoutes.post("/plans", manage, c.createPlan);
internalAuditRoutes.put("/plans/:id", manage, c.updatePlan);
internalAuditRoutes.post("/plans/:id/status", manage, c.setPlanStatus);

// Sessions
internalAuditRoutes.get("/sessions", read, c.listSessions);
internalAuditRoutes.post("/sessions", manage, c.createSession);
internalAuditRoutes.put("/sessions/:id", manage, c.updateSession);
internalAuditRoutes.post("/sessions/:id/status", manage, c.setSessionStatus);

// Findings
internalAuditRoutes.get("/findings", read, c.listFindings);
internalAuditRoutes.post("/findings", manage, c.createFinding);
internalAuditRoutes.put("/findings/:id", manage, c.updateFinding);
internalAuditRoutes.post("/findings/:id/review", manage, c.reviewFinding);
internalAuditRoutes.post("/findings/:id/issue", manage, c.issueFinding);
internalAuditRoutes.post("/findings/:id/route", manage, c.routeFinding);

// Reports
internalAuditRoutes.get("/reports", read, c.listReports);
internalAuditRoutes.post("/reports", manage, c.generateReport);
internalAuditRoutes.post("/reports/:id/status", manage, c.setReportStatus);
