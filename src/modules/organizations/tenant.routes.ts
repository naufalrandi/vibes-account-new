import { Router } from "express";
import * as c from "./tenant.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const tenantRoutes = Router();
tenantRoutes.get("/", requireAction(ACTIONS.TENANT_READ), c.list);
tenantRoutes.get("/:id", requireAction(ACTIONS.TENANT_READ), c.get);
tenantRoutes.post("/", requireAction(ACTIONS.TENANT_PROVISION), c.provision);
tenantRoutes.post("/:id/send-activation", requireAction(ACTIONS.ORG_ACTIVATE), c.sendActivation);
tenantRoutes.post("/:id/resend-activation", requireAction(ACTIONS.ORG_ACTIVATE), c.resendActivation);
tenantRoutes.post("/:id/activate", requireAction(ACTIONS.ORG_ACTIVATE), c.activate);
tenantRoutes.post("/:id/suspend", requireAction(ACTIONS.ORG_SUSPEND), c.suspend);
tenantRoutes.post("/:id/resume", requireAction(ACTIONS.ORG_ACTIVATE), c.resume);
tenantRoutes.post("/:id/deactivate", requireAction(ACTIONS.ORG_DEACTIVATE), c.deactivate);
tenantRoutes.post("/:id/reactivate", requireAction(ACTIONS.ORG_ACTIVATE), c.reactivate);
