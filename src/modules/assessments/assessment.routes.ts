import { Router } from "express";
import * as c from "./assessment.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const assessmentRunRoutes = Router();
assessmentRunRoutes.get("/", requireAction(ACTIONS.ASSESSMENT_RUN_READ), c.list);
assessmentRunRoutes.post("/", requireAction(ACTIONS.ASSESSMENT_RUN_MANAGE), c.create);
assessmentRunRoutes.get("/:id", requireAction(ACTIONS.ASSESSMENT_RUN_READ), c.get);
assessmentRunRoutes.post("/:id/answers", requireAction(ACTIONS.ASSESSMENT_RUN_MANAGE), c.answers);
assessmentRunRoutes.post("/:id/finalize", requireAction(ACTIONS.ASSESSMENT_RUN_MANAGE), c.finalize);
assessmentRunRoutes.get("/:id/results", requireAction(ACTIONS.ASSESSMENT_RUN_READ), c.results);
assessmentRunRoutes.get("/:id/gaps", requireAction(ACTIONS.ASSESSMENT_RUN_READ), c.gaps);
assessmentRunRoutes.post("/:id/reassess", requireAction(ACTIONS.ASSESSMENT_RUN_MANAGE), c.reassess);
