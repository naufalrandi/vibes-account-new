import { Router } from "express";
import * as c from "./partner.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const partnerRoutes = Router();
partnerRoutes.get("/", requireAction(ACTIONS.PARTNER_READ), c.list);
partnerRoutes.post("/", requireAction(ACTIONS.PARTNER_CREATE), c.create);
partnerRoutes.get("/:id", requireAction(ACTIONS.PARTNER_READ), c.get);
partnerRoutes.put("/:id", requireAction(ACTIONS.PARTNER_UPDATE), c.update);
partnerRoutes.post("/:id/activate", requireAction(ACTIONS.PARTNER_LIFECYCLE), c.activate);
partnerRoutes.post("/:id/suspend", requireAction(ACTIONS.PARTNER_LIFECYCLE), c.suspend);
partnerRoutes.post("/:id/resume", requireAction(ACTIONS.PARTNER_LIFECYCLE), c.resume);
partnerRoutes.post("/:id/terminate", requireAction(ACTIONS.PARTNER_LIFECYCLE), c.terminate);

// Per-partner agreement instance (generated from a template, with filled variables).
partnerRoutes.get("/:id/agreement", requireAction(ACTIONS.PARTNER_READ), c.getAgreement);
partnerRoutes.post("/:id/agreement/generate", requireAction(ACTIONS.PARTNER_AGREEMENT_MANAGE), c.generateAgreement);
partnerRoutes.post("/:id/agreement/regenerate", requireAction(ACTIONS.PARTNER_AGREEMENT_MANAGE), c.regenerateAgreement);
partnerRoutes.post("/:id/agreement/resend", requireAction(ACTIONS.PARTNER_AGREEMENT_MANAGE), c.resendAgreement);
partnerRoutes.post("/:id/agreement/approve", requireAction(ACTIONS.PARTNER_AGREEMENT_MANAGE), c.approveAgreement);
