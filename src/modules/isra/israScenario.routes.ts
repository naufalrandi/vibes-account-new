import { Router } from "express";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";
import * as controller from "./israScenario.controller";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const manage = requireAction(ACTIONS.ISRA_ORG_CONTROL_MANAGE);

export const israScenarioRoutes = Router();

// Read operations
israScenarioRoutes.get("/", read, controller.listScenarios);
israScenarioRoutes.get("/:id", read, controller.getScenarioById);

// Mutate operations
israScenarioRoutes.post("/", manage, controller.createScenario);
israScenarioRoutes.put("/:id", manage, controller.updateScenario);
israScenarioRoutes.delete("/:id", manage, controller.deleteScenario);

// Controls
israScenarioRoutes.post("/:id/controls", manage, controller.createExistingControl);
israScenarioRoutes.put("/:id/controls/:controlId", manage, controller.updateExistingControl);
israScenarioRoutes.delete("/:id/controls/:controlId", manage, controller.deleteExistingControl);

// Treatments & Recommendations
israScenarioRoutes.post("/:id/treatment", manage, controller.saveTreatmentDecision);
israScenarioRoutes.post("/:id/recommendations", manage, controller.generateRecommendations);

// RTP
israScenarioRoutes.post("/:id/rtp", manage, controller.saveRtp);
israScenarioRoutes.post("/:id/rtp/approve", manage, controller.approveRtp);

// Residuals
israScenarioRoutes.post("/:id/residual", manage, controller.saveResidual);
israScenarioRoutes.post("/:id/residual/promote", manage, controller.promoteResidual);
israScenarioRoutes.post("/:id/projected-residual", manage, controller.saveProjectedResidual);
