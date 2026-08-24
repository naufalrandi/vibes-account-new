import { Router } from "express";
import * as c from "./saas.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const saasRoutes = Router();

saasRoutes.get("/pipeline", requireAction(ACTIONS.SAAS_READ), c.listPipeline);
saasRoutes.get("/pipeline/:id", requireAction(ACTIONS.SAAS_READ), c.getPipelineEntry);
saasRoutes.post("/pipeline", requireAction(ACTIONS.SAAS_MANAGE), c.createPipelineQuote);

saasRoutes.get("/subscriptions", requireAction(ACTIONS.SAAS_READ), c.listSubscriptions);
saasRoutes.get("/subscriptions/:id", requireAction(ACTIONS.SAAS_READ), c.getSubscription);
saasRoutes.post("/subscriptions/:id/renew", requireAction(ACTIONS.SAAS_MANAGE), c.renewSubscription);

saasRoutes.get("/workspaces", requireAction(ACTIONS.SAAS_READ), c.listWorkspaces);
saasRoutes.get("/workspaces/:id", requireAction(ACTIONS.SAAS_READ), c.getWorkspace);
