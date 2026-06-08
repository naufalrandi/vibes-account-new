import { Router } from "express";
import * as c from "./assessment.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const assessmentRoutes = Router();
// Element assessment (questions + responses + scoring) — read + manage.
assessmentRoutes.get("/elements/:elementId", requireAction(ACTIONS.ASSESSMENT_READ), c.elementAssessment);
assessmentRoutes.get("/response-criteria", requireAction(ACTIONS.ASSESSMENT_READ), c.responseCriteriaMap);
assessmentRoutes.get("/criterion-options", requireAction(ACTIONS.ASSESSMENT_READ), c.criterionOptions);

assessmentRoutes.post("/questions", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.createQuestion);
assessmentRoutes.put("/questions/:id", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.updateQuestion);
assessmentRoutes.delete("/questions/:id", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.removeQuestion);

assessmentRoutes.post("/responses", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.createResponse);
assessmentRoutes.put("/responses/:id", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.updateResponse);
assessmentRoutes.delete("/responses/:id", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.removeResponse);
assessmentRoutes.put("/responses/:id/criterion", requireAction(ACTIONS.ASSESSMENT_MANAGE), c.setResponseCriterion);
