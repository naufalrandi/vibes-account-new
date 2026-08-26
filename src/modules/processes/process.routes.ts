import { Router } from "express";
import * as c from "./process.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const processRoutes = Router();

processRoutes.get("/", requireAction(ACTIONS.PROCESS_READ), c.list);
processRoutes.post("/sync-catalog", requireAction(ACTIONS.PROCESS_MANAGE), c.syncCatalog);
processRoutes.post("/", requireAction(ACTIONS.PROCESS_MANAGE), c.create);
processRoutes.get("/:id", requireAction(ACTIONS.PROCESS_READ), c.get);
processRoutes.put("/:id", requireAction(ACTIONS.PROCESS_MANAGE), c.update);
processRoutes.post("/:id/archive", requireAction(ACTIONS.PROCESS_MANAGE), c.archive);

processRoutes.get("/:id/steps", requireAction(ACTIONS.PROCESS_READ), c.listSteps);
processRoutes.post("/:id/steps", requireAction(ACTIONS.PROCESS_MANAGE), c.addStep);
processRoutes.put("/:id/steps/:stepId", requireAction(ACTIONS.PROCESS_MANAGE), c.updateStep);
processRoutes.delete("/:id/steps/:stepId", requireAction(ACTIONS.PROCESS_MANAGE), c.deleteStep);

processRoutes.get("/:id/steps/:stepId/risks", requireAction(ACTIONS.PROCESS_READ), c.stepRisks);
processRoutes.post("/:id/steps/:stepId/risks", requireAction(ACTIONS.PROCESS_MANAGE), c.raiseStepRisk);
