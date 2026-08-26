import { Router } from "express";
import * as c from "./lims.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const limsRoutes = Router();
// The LIMS area map — the backend home `tn-m-lab-operations` resolves to
// (OD `setPlat('axia','lims')`, core.js:8951), not a clause register.
limsRoutes.get("/area", requireAction(ACTIONS.LIMS_READ), c.getArea);
// Static workflow catalog + preview generation.
limsRoutes.get("/workflow-config", requireAction(ACTIONS.LIMS_READ), c.getWorkflowConfig);
limsRoutes.get("/workflow-preview", requireAction(ACTIONS.LIMS_READ), c.preview);
// Testing-service master data.
limsRoutes.get("/testing-services", requireAction(ACTIONS.LIMS_READ), c.listServices);
limsRoutes.post("/testing-services", requireAction(ACTIONS.LIMS_MANAGE), c.createService);
limsRoutes.get("/testing-services/:id", requireAction(ACTIONS.LIMS_READ), c.getService);
limsRoutes.put("/testing-services/:id", requireAction(ACTIONS.LIMS_MANAGE), c.updateService);
limsRoutes.delete("/testing-services/:id", requireAction(ACTIONS.LIMS_MANAGE), c.removeService);
