import { Router } from "express";
import * as c from "./audit.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const auditRoutes = Router();
auditRoutes.get("/", requireAction(ACTIONS.AUDIT_READ), c.list);
auditRoutes.get("/login-history/:id", requireAction(ACTIONS.AUDIT_READ), c.loginHistory);
