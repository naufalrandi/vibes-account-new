import { Router } from "express";
import * as c from "./partner.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const partnerRoutes = Router();
partnerRoutes.get("/", requireAction(ACTIONS.PARTNER_READ), c.list);
partnerRoutes.post("/", requireAction(ACTIONS.PARTNER_CREATE), c.create);
partnerRoutes.get("/:id", requireAction(ACTIONS.PARTNER_READ), c.get);
partnerRoutes.put("/:id", requireAction(ACTIONS.PARTNER_UPDATE), c.update);

// Partner-detail sub-resources (read-only SP views: team, tenants, billing).
partnerRoutes.get("/:id/team", requireAction(ACTIONS.PARTNER_READ), c.team);
partnerRoutes.get("/:id/tenants", requireAction(ACTIONS.PARTNER_READ), c.tenants);
partnerRoutes.get("/:id/billing", requireAction(ACTIONS.PARTNER_READ), c.billing);

// Lifecycle transitions (gated by PARTNER_UPDATE; each validates the current
// status server-side and rejects illegal transitions with 409).
partnerRoutes.post("/:id/activate", requireAction(ACTIONS.PARTNER_UPDATE), c.activate);
partnerRoutes.post("/:id/suspend", requireAction(ACTIONS.PARTNER_UPDATE), c.suspend);
partnerRoutes.post("/:id/resume", requireAction(ACTIONS.PARTNER_UPDATE), c.resume);
partnerRoutes.post("/:id/terminate", requireAction(ACTIONS.PARTNER_UPDATE), c.terminate);

// Per-partner agreement sub-resource.
partnerRoutes.get("/:id/agreement", requireAction(ACTIONS.PARTNER_READ), c.getAgreement);
partnerRoutes.post("/:id/agreement/generate", requireAction(ACTIONS.PARTNER_UPDATE), c.generate);
partnerRoutes.post("/:id/agreement/regenerate", requireAction(ACTIONS.PARTNER_UPDATE), c.regenerate);
partnerRoutes.post("/:id/agreement/resend", requireAction(ACTIONS.PARTNER_UPDATE), c.resend);
partnerRoutes.post("/:id/agreement/approve", requireAction(ACTIONS.PARTNER_UPDATE), c.approve);
