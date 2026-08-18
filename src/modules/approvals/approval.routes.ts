import { Router } from "express";
import * as c from "./approval.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.APPROVAL_READ);
const manage = requireAction(ACTIONS.APPROVAL_MANAGE);
const approve = requireAction(ACTIONS.APPROVAL_APPROVE);

export const approvalRoutes = Router();

// Schemes
approvalRoutes.get("/schemes", read, c.listSchemes);
approvalRoutes.post("/schemes", manage, c.createScheme);
approvalRoutes.put("/schemes/:code", manage, c.updateScheme);
approvalRoutes.delete("/schemes/:code", manage, c.deleteScheme);

// Module → scheme map
approvalRoutes.get("/module-map", read, c.getModuleMap);
approvalRoutes.put("/module-map", manage, c.setModuleScheme);

// Pool membership
approvalRoutes.get("/pools", read, c.listPoolMembers);
approvalRoutes.put("/pools/:userId", manage, c.setPoolMember);

// Settings
approvalRoutes.get("/settings", read, c.getSettings);
approvalRoutes.put("/settings", manage, c.setSettings);

// Governed record workflow
approvalRoutes.get("/records/:module/:recordId", read, c.getRecord);
approvalRoutes.post("/records/:module/:recordId/submit", approve, c.submit);
approvalRoutes.post("/records/:module/:recordId/approve", approve, c.approve);
approvalRoutes.post("/records/:module/:recordId/request-revision", approve, c.requestRevision);
approvalRoutes.post("/records/:module/:recordId/withdraw", approve, c.withdraw);
// Controlled documents — bespoke review decision + explicit publish (OD cdReview/cdPublish).
approvalRoutes.post("/records/:module/:recordId/review", approve, c.review);
approvalRoutes.post("/records/:module/:recordId/publish", approve, c.publish);
