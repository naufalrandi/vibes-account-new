import { Router } from "express";
import * as c from "./saas.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const saasRoutes = Router();

saasRoutes.get("/pipeline", requireAction(ACTIONS.SAAS_READ), c.listPipeline);
saasRoutes.get("/pipeline/:id", requireAction(ACTIONS.SAAS_READ), c.getPipelineEntry);
saasRoutes.post("/pipeline", requireAction(ACTIONS.SAAS_MANAGE), c.createPipelineQuote);

// Stage-transition actions (OD `pipeRowActions`, app.html:10693) — legality
// enforced per-stage in pipeline.transitions.ts, not by route ordering.
saasRoutes.post("/pipeline/:id/accept", requireAction(ACTIONS.SAAS_MANAGE), c.acceptPipeline);
saasRoutes.post("/pipeline/:id/decline", requireAction(ACTIONS.SAAS_MANAGE), c.declinePipeline);
saasRoutes.post("/pipeline/:id/registration", requireAction(ACTIONS.SAAS_MANAGE), c.saveRegistration);
saasRoutes.post("/pipeline/:id/proof", requireAction(ACTIONS.SAAS_MANAGE), c.uploadPaymentProof);
saasRoutes.post("/pipeline/:id/verify", requireAction(ACTIONS.SAAS_MANAGE), c.verifyPayment);
saasRoutes.post("/pipeline/:id/provision", requireAction(ACTIONS.SAAS_MANAGE), c.provisionPipeline);

saasRoutes.get("/subscriptions", requireAction(ACTIONS.SAAS_READ), c.listSubscriptions);
saasRoutes.get("/subscriptions/:id", requireAction(ACTIONS.SAAS_READ), c.getSubscription);
saasRoutes.post("/subscriptions/:id/renew", requireAction(ACTIONS.SAAS_MANAGE), c.renewSubscription);

saasRoutes.get("/workspaces", requireAction(ACTIONS.SAAS_READ), c.listWorkspaces);
saasRoutes.get("/workspaces/:id", requireAction(ACTIONS.SAAS_READ), c.getWorkspace);
