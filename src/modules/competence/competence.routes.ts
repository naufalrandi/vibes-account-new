import { Router } from "express";
import * as c from "./competence.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.COMPETENCE_READ);
const manage = requireAction(ACTIONS.COMPETENCE_MANAGE);

export const competenceRoutes = Router();

competenceRoutes.get("/education", read, c.listEducation);
competenceRoutes.post("/education", manage, c.createEducation);
competenceRoutes.put("/education/:id", manage, c.updateEducation);
competenceRoutes.delete("/education/:id", manage, c.deleteEducation);

competenceRoutes.get("/skills", read, c.listSkills);
competenceRoutes.post("/skills", manage, c.createSkill);
competenceRoutes.put("/skills/:id", manage, c.updateSkill);
competenceRoutes.delete("/skills/:id", manage, c.deleteSkill);

competenceRoutes.get("/training", read, c.listTraining);
competenceRoutes.post("/training", manage, c.createTraining);
competenceRoutes.put("/training/:id", manage, c.updateTraining);
competenceRoutes.delete("/training/:id", manage, c.deleteTraining);

// Settings (OD `compSettings`, index.html:13378)
competenceRoutes.get("/settings", read, c.getCompetenceSettings);
competenceRoutes.put("/settings", manage, c.putCompetenceSettings);

// Roles (competence profiles)
competenceRoutes.get("/roles", read, c.listRoles);
competenceRoutes.post("/roles", manage, c.createRole);
competenceRoutes.put("/roles/:id", manage, c.updateRole);
competenceRoutes.post("/roles/:id/status", manage, c.setRoleStatus);
competenceRoutes.delete("/roles/:id", manage, c.deleteRole);

// Assignments
competenceRoutes.get("/assignments", read, c.listAssignments);
competenceRoutes.post("/assignments", manage, c.assignRole);
competenceRoutes.post("/assignments/:id/status", manage, c.setAssignmentStatus);
competenceRoutes.get("/assignments/:id/checklist", read, c.getChecklist);

// Assessments
competenceRoutes.get("/assessments", read, c.listAssessments);
competenceRoutes.get("/assessments/reassess-queue", read, c.reassessQueue);
competenceRoutes.get("/assessments/:id", read, c.getAssessment);
competenceRoutes.post("/assessments", manage, c.createAssessment);
competenceRoutes.post("/assessments/:id/approve", manage, c.approveAssessment);

// Development gaps
competenceRoutes.get("/gaps", read, c.listGaps);
competenceRoutes.put("/gaps/:id", manage, c.updateGap);
// Disposition actions (OD `compGapLinkTraining` / `compGapNoTraining`)
competenceRoutes.post("/gaps/:id/link-training-plan", manage, c.linkGapTrainingPlan);
competenceRoutes.post("/gaps/:id/no-training", manage, c.markGapNoTrainingRequired);

// Assessment instruments — exam ladder (L1–L3)
competenceRoutes.get("/instruments/exams", read, c.listExams);
competenceRoutes.post("/instruments/exams", manage, c.createExam);
competenceRoutes.put("/instruments/exams/:id", manage, c.updateExam);
competenceRoutes.post("/instruments/exams/:id/status", manage, c.setExamStatus);
competenceRoutes.delete("/instruments/exams/:id", manage, c.deleteExam);
competenceRoutes.post("/instruments/exams/:id/take", manage, c.takeExam);
// Assessor grading phase for short-answer exams (finalizes a PendingGrading attempt).
competenceRoutes.post("/instruments/exams/attempts/:id/grade", manage, c.gradeExamAttempt);

// Assessment instruments — L4 practical
competenceRoutes.get("/instruments/practicals", read, c.listPracticals);
competenceRoutes.post("/instruments/practicals", manage, c.createPractical);
competenceRoutes.put("/instruments/practicals/:id", manage, c.updatePractical);
competenceRoutes.post("/instruments/practicals/:id/status", manage, c.setPracticalStatus);
competenceRoutes.delete("/instruments/practicals/:id", manage, c.deletePractical);
competenceRoutes.post("/instruments/practicals/:id/run", manage, c.runPractical);

// Attempts + ladder level
competenceRoutes.get("/attempts", read, c.listAttempts);
competenceRoutes.get("/skills/:skillId/level", read, c.skillLevel);
