import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./competence.service";
import * as assess from "./competence.assessment.service";
import * as instr from "./competence.instrument.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
const statusSchema = z.object({ status: z.string().min(1).max(80) });
function guard(req: Request): AuthContext { if (!req.auth) throw new UnauthorizedError(); return req.auth; }
const ip = (req: Request) => req.ip ?? null;
const listMeta = (data: unknown[]) => ({ page: 1, limit: data.length, total: data.length });
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Education
export const listEducation = wrap(async (_req, res) => { const d = await service.listEducation(); sendOk(res, d, 200, listMeta(d)); });
export const createEducation = wrap(async (req, res) => sendOk(res, await service.createEducation(guard(req), body.parse(req.body), ip(req)), 201));
export const updateEducation = wrap(async (req, res) => sendOk(res, await service.updateEducation(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteEducation = wrap(async (req, res) => { const r = await service.deleteEducation(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id, ...r }); });

// Skills
export const listSkills = wrap(async (req, res) => { const d = await service.listSkills(guard(req), { type: typeof req.query.type === "string" ? req.query.type : undefined }); sendOk(res, d, 200, listMeta(d)); });
export const createSkill = wrap(async (req, res) => sendOk(res, await service.createSkill(guard(req), body.parse(req.body), ip(req)), 201));
export const updateSkill = wrap(async (req, res) => sendOk(res, await service.updateSkill(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteSkill = wrap(async (req, res) => { await service.deleteSkill(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });

// Training
export const listTraining = wrap(async (req, res) => { const d = await service.listTraining(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const createTraining = wrap(async (req, res) => sendOk(res, await service.createTraining(guard(req), body.parse(req.body), ip(req)), 201));
export const updateTraining = wrap(async (req, res) => sendOk(res, await service.updateTraining(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteTraining = wrap(async (req, res) => { await service.deleteTraining(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });

// Settings (OD `compSettings`, index.html:13378)
export const getCompetenceSettings = wrap(async (req, res) => sendOk(res, await service.getCompSettings(guard(req).orgId)));
export const putCompetenceSettings = wrap(async (req, res) => sendOk(res, await service.setCompSettings(guard(req), body.parse(req.body), ip(req))));

// Roles (competence profiles)
export const listRoles = wrap(async (req, res) => { const d = await assess.listRoles(guard(req), req.query.scope === "enterprise" ? "enterprise" : undefined); sendOk(res, d, 200, listMeta(d)); });
export const createRole = wrap(async (req, res) => sendOk(res, await assess.createRole(guard(req), body.parse(req.body), ip(req)), 201));
export const updateRole = wrap(async (req, res) => sendOk(res, await assess.updateRole(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setRoleStatus = wrap(async (req, res) => sendOk(res, await assess.setRoleStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
export const deleteRole = wrap(async (req, res) => { await assess.deleteRole(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });

// Assignments
export const listAssignments = wrap(async (req, res) => { const d = await assess.listAssignments(guard(req), req.query.scope === "enterprise" ? "enterprise" : undefined); sendOk(res, d, 200, listMeta(d)); });
export const assignRole = wrap(async (req, res) => sendOk(res, await assess.assignRole(guard(req), body.parse(req.body), ip(req)), 201));
export const setAssignmentStatus = wrap(async (req, res) => sendOk(res, await assess.setAssignmentStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
export const getChecklist = wrap(async (req, res) => sendOk(res, await assess.getChecklist(guard(req), req.params.id as string)));

// Assessments
export const listAssessments = wrap(async (req, res) => { const d = await assess.listAssessments(guard(req), req.query.scope === "enterprise" ? "enterprise" : undefined); sendOk(res, d, 200, listMeta(d)); });
export const getAssessment = wrap(async (req, res) => sendOk(res, await assess.getAssessment(guard(req), req.params.id as string)));
export const createAssessment = wrap(async (req, res) => sendOk(res, await assess.createAssessment(guard(req), body.parse(req.body), ip(req)), 201));
export const approveAssessment = wrap(async (req, res) => sendOk(res, await assess.approveAssessment(guard(req), req.params.id as string, ip(req))));
export const reassessQueue = wrap(async (req, res) => sendOk(res, await assess.reassessQueue(guard(req), req.query.scope === "enterprise" ? "enterprise" : undefined)));

// Gaps
export const listGaps = wrap(async (req, res) => { const d = await assess.listGaps(guard(req), req.query.scope === "enterprise" ? "enterprise" : undefined); sendOk(res, d, 200, listMeta(d)); });
export const updateGap = wrap(async (req, res) => sendOk(res, await assess.updateGap(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
// Disposition actions (OD `compGapLinkTraining` / `compGapNoTraining`, index.html:14217-14226)
const linkTrainingSchema = z.object({ trainingPlanId: z.string().min(1) });
const noTrainingSchema = z.object({ reason: z.string() });
export const linkGapTrainingPlan = wrap(async (req, res) => sendOk(res, await assess.linkGapTrainingPlan(guard(req), req.params.id as string, linkTrainingSchema.parse(req.body).trainingPlanId, ip(req))));
export const markGapNoTrainingRequired = wrap(async (req, res) => sendOk(res, await assess.markGapNoTrainingRequired(guard(req), req.params.id as string, noTrainingSchema.parse(req.body).reason, ip(req))));

// Exam instruments (L1–L3)
const skillFilter = (req: Request) => ({ skillId: typeof req.query.skillId === "string" ? req.query.skillId : undefined });
export const listExams = wrap(async (req, res) => { const d = await instr.listExamInstruments(guard(req), skillFilter(req)); sendOk(res, d, 200, listMeta(d)); });
export const createExam = wrap(async (req, res) => sendOk(res, await instr.createExamInstrument(guard(req), body.parse(req.body), ip(req)), 201));
export const updateExam = wrap(async (req, res) => sendOk(res, await instr.updateExamInstrument(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setExamStatus = wrap(async (req, res) => sendOk(res, await instr.setExamStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
export const deleteExam = wrap(async (req, res) => { await instr.deleteExamInstrument(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });
export const takeExam = wrap(async (req, res) => sendOk(res, await instr.takeExam(guard(req), req.params.id as string, body.parse(req.body), ip(req)), 201));
export const gradeExamAttempt = wrap(async (req, res) => sendOk(res, await instr.gradeExamAttempt(guard(req), req.params.id as string, body.parse(req.body), ip(req))));

// Practical instruments (L4)
export const listPracticals = wrap(async (req, res) => { const d = await instr.listPracticalInstruments(guard(req), skillFilter(req)); sendOk(res, d, 200, listMeta(d)); });
export const createPractical = wrap(async (req, res) => sendOk(res, await instr.createPracticalInstrument(guard(req), body.parse(req.body), ip(req)), 201));
export const updatePractical = wrap(async (req, res) => sendOk(res, await instr.updatePracticalInstrument(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setPracticalStatus = wrap(async (req, res) => sendOk(res, await instr.setPracticalStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
export const deletePractical = wrap(async (req, res) => { await instr.deletePracticalInstrument(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });
export const runPractical = wrap(async (req, res) => sendOk(res, await instr.runPractical(guard(req), req.params.id as string, body.parse(req.body), ip(req)), 201));

// Attempts + ladder
export const listAttempts = wrap(async (req, res) => sendOk(res, await instr.listAttempts(guard(req), { personId: typeof req.query.personId === "string" ? req.query.personId : undefined, skillId: typeof req.query.skillId === "string" ? req.query.skillId : undefined })));
export const skillLevel = wrap(async (req, res) => sendOk(res, await instr.skillLevel(guard(req), req.params.skillId as string, typeof req.query.personId === "string" ? req.query.personId : "")));
