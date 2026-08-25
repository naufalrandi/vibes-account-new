import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import * as c from "./saas.controller";
import { requireAction } from "../../middleware/requireAction";
import { ForbiddenError } from "../../lib/errors";
import { ACTIONS } from "../iam/actions.catalog";

export const saasRoutes = Router();

/**
 * SaaS pipeline, subscription and workspace rows span every tenant, and the
 * service layer reads them unfiltered by design — this module IS the Service
 * Owner's cross-tenant view. Until now the only thing keeping a tenant out was
 * `tenantGrants.ts` withholding `saas.read`/`saas.manage` from tenant and
 * distributor admin roles. That is one policy-list edit away from a
 * cross-tenant leak, and `requireAction` is bypassed outright by any
 * `isSuperAdmin` role — including one created inside a tenant. `orgType` comes
 * from the verified JWT, so gating on it here makes the boundary structural
 * rather than a grant the IAM screen can hand out.
 */
saasRoutes.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.auth?.orgType !== "ServiceOwner") {
    return next(new ForbiddenError("SaaS pipeline, subscriptions and workspaces are Service Owner only"));
  }
  next();
});

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
