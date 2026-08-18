import { Router } from "express";
import * as c from "./implementation.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// One router serves every clause register; `:module` selects the register.
export const implementationRoutes = Router();
// Controlled-document settings (OD `cdSettings`) — registered before the
// generic routes so PUT /documents/settings is never captured as /:module/:id.
implementationRoutes.get("/documents/settings", requireAction(ACTIONS.MS_READ), c.getDocumentSettings);
implementationRoutes.put("/documents/settings", requireAction(ACTIONS.MS_MANAGE), c.putDocumentSettings);
// Awareness governance settings (OD `awSettings`) + the campaign launch /
// acknowledgment / evaluation endpoints — registered before the generic
// routes so PUT /awareness/settings is never captured as /:module/:id.
implementationRoutes.get("/awareness/settings", requireAction(ACTIONS.MS_READ), c.getAwarenessSettings);
implementationRoutes.put("/awareness/settings", requireAction(ACTIONS.MS_MANAGE), c.putAwarenessSettings);
implementationRoutes.post("/awareness-campaigns/:id/launch", requireAction(ACTIONS.MS_MANAGE), c.launchAwarenessCampaign);
implementationRoutes.post("/awareness-campaigns/:id/acks/:ackId/acknowledge", requireAction(ACTIONS.MS_MANAGE), c.acknowledgeAwarenessAck);
implementationRoutes.post("/awareness-campaigns/:id/acks/:ackId/remind", requireAction(ACTIONS.MS_MANAGE), c.remindAwarenessAck);
implementationRoutes.post("/awareness-campaigns/:id/acks/:ackId/waive", requireAction(ACTIONS.MS_MANAGE), c.waiveAwarenessAck);
implementationRoutes.post("/awareness-campaigns/:id/evals/:evalId/result", requireAction(ACTIONS.MS_MANAGE), c.recordAwarenessEvaluation);
implementationRoutes.post("/awareness-campaigns/:id/evals/:evalId/followup", requireAction(ACTIONS.MS_MANAGE), c.createAwarenessFollowup);
implementationRoutes.post("/awareness-campaigns/:id/evals/:evalId/training-plan", requireAction(ACTIONS.MS_MANAGE), c.awarenessEvalToTraining);
implementationRoutes.get("/:module", requireAction(ACTIONS.MS_READ), c.list);
implementationRoutes.post("/:module", requireAction(ACTIONS.MS_MANAGE), c.create);
implementationRoutes.post("/concerns/:id/route", requireAction(ACTIONS.MS_MANAGE), c.routeConcern);
implementationRoutes.put("/:module/:id", requireAction(ACTIONS.MS_MANAGE), c.update);
implementationRoutes.delete("/:module/:id", requireAction(ACTIONS.MS_MANAGE), c.remove);
