import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./assessment.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active"]);
const dimensionSchema = z.enum(["Coverage", "Maturity"]);
const qCreate = z.object({
  elementId: z.string().uuid(), text: z.string().min(1), sortOrder: z.number().int().optional(), status: statusSchema.optional(),
  dimension: dimensionSchema.optional(), category: z.string().nullish(), code: z.string().nullish(), title: z.string().nullish(),
});
const qUpdate = z.object({
  text: z.string().min(1).optional(), sortOrder: z.number().int().optional(), status: statusSchema.optional(),
  dimension: dimensionSchema.optional(), category: z.string().nullish(), code: z.string().nullish(), title: z.string().nullish(),
});
const rCreate = z.object({
  questionId: z.string().uuid(), text: z.string().min(1), sortOrder: z.number().int().optional(), status: statusSchema.optional(),
  code: z.string().nullish(), child: z.boolean().optional(),
});
const rUpdate = z.object({
  text: z.string().min(1).optional(), sortOrder: z.number().int().optional(), status: statusSchema.optional(),
  code: z.string().nullish(), child: z.boolean().optional(),
});
const critSchema = z.object({ criterionId: z.string().uuid().nullable() });
const answerSchema = z.object({ responseId: z.string().uuid().nullable(), frameworks: z.array(z.string()).optional() });

const guard = (req: Request) => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };

export async function elementAssessment(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getElementAssessment(guard(req), req.params.id as string)); } catch (e) { next(e); }
}
export async function createQuestion(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createQuestion(guard(req), qCreate.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function updateQuestion(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateQuestion(guard(req), req.params.id as string, qUpdate.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function removeQuestion(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteQuestion(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
export async function createResponse(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createResponse(guard(req), rCreate.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function updateResponse(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateResponse(guard(req), req.params.id as string, rUpdate.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function removeResponse(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteResponse(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
export async function setCriterion(req: Request, res: Response, next: NextFunction) {
  try { const { criterionId } = critSchema.parse(req.body); sendOk(res, await service.setResponseCriterion(guard(req), req.params.id as string, criterionId, req.ip ?? null)); } catch (e) { next(e); }
}
export async function responseCriteria(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listResponseCriteria(guard(req)); sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length }); } catch (e) { next(e); }
}
export async function criterionOptions(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listCriterionOptions(guard(req)); sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length }); } catch (e) { next(e); }
}
export async function listAnswers(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listElementAssessmentAnswers(guard(req), req.params.id as string);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}
export async function setAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const { responseId, frameworks } = answerSchema.parse(req.body);
    sendOk(res, await service.setElementAssessmentAnswer(guard(req), req.params.id as string, req.params.questionId as string, responseId, frameworks ?? []));
  } catch (e) { next(e); }
}
export async function resetAssessment(req: Request, res: Response, next: NextFunction) {
  try { await service.resetElementAssessment(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
