import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./assessment.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active"]);
const createQuestionSchema = z.object({ elementId: z.string().uuid(), text: z.string().min(1), sortOrder: z.number().int().optional(), status: statusSchema.optional() });
const updateQuestionSchema = z.object({ text: z.string().min(1).optional(), sortOrder: z.number().int().optional(), status: statusSchema.optional() });
const createResponseSchema = z.object({ questionId: z.string().uuid(), text: z.string().min(1), sortOrder: z.number().int().optional(), status: statusSchema.optional() });
const updateResponseSchema = z.object({ text: z.string().min(1).optional(), sortOrder: z.number().int().optional(), status: statusSchema.optional() });
const criterionSchema = z.object({ criterionId: z.string().uuid().nullable() });

export async function elementAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getElementAssessment(req.auth, req.params.elementId as string));
  } catch (e) {
    next(e);
  }
}

export async function createQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.createQuestion(req.auth, createQuestionSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}
export async function updateQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.updateQuestion(req.auth, req.params.id as string, updateQuestionSchema.parse(req.body), req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
export async function removeQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteQuestion(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

export async function createResponse(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.createResponse(req.auth, createResponseSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}
export async function updateResponse(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.updateResponse(req.auth, req.params.id as string, updateResponseSchema.parse(req.body), req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
export async function removeResponse(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteResponse(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
export async function setResponseCriterion(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { criterionId } = criterionSchema.parse(req.body);
    sendOk(res, await service.setResponseCriterion(req.auth, req.params.id as string, criterionId, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function responseCriteriaMap(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listResponseCriteriaMap(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}
export async function criterionOptions(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listCriterionOptions(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}
