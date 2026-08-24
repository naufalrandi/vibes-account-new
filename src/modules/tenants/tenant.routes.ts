import { Router } from "express";
import * as c from "./tenant.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const tenantRoutes = Router();
tenantRoutes.get("/", requireAction(ACTIONS.TENANT_READ), c.list);
tenantRoutes.post("/", requireAction(ACTIONS.TENANT_CREATE), c.provision);
tenantRoutes.get("/:id", requireAction(ACTIONS.TENANT_READ), c.get);
// Edit Tenant (OD `tenantEdit`, app.html:10483). The service additionally
// enforces Service-Owner-only, like direct provisioning.
tenantRoutes.put("/:id", requireAction(ACTIONS.TENANT_UPDATE), c.update);

// Lifecycle (gated by TENANT_UPDATE; each validates the current status server-side).
tenantRoutes.post("/:id/send-activation", requireAction(ACTIONS.TENANT_UPDATE), c.sendActivation);
tenantRoutes.post("/:id/resend-activation", requireAction(ACTIONS.TENANT_UPDATE), c.resendActivation);
tenantRoutes.post("/:id/activate", requireAction(ACTIONS.TENANT_UPDATE), c.activate);
tenantRoutes.post("/:id/suspend", requireAction(ACTIONS.TENANT_UPDATE), c.suspend);
tenantRoutes.post("/:id/resume", requireAction(ACTIONS.TENANT_UPDATE), c.resume);
tenantRoutes.post("/:id/deactivate", requireAction(ACTIONS.TENANT_UPDATE), c.deactivate);
tenantRoutes.post("/:id/reactivate", requireAction(ACTIONS.TENANT_UPDATE), c.reactivate);
