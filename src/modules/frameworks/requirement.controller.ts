import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./requirement.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError, BadRequestError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active", "Archived"]);
// `type` is no longer accepted from clients: Header/Requirement is derived from
// the code hierarchy server-side (OD classifyReqArray, index.html:2241-2248).
// Zod strips the key silently if a legacy client still sends it.
const createSchema = z.object({
  frameworkId: z.string().uuid(),
  code: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().min(1),
  shortLabel: z.string().nullish(),
  status: statusSchema.optional(),
});
const updateSchema = z.object({
  code: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  shortLabel: z.string().nullish(),
  status: statusSchema.optional(),
});
const critCreateSchema = z.object({
  requirementId: z.string().uuid(),
  score: z.number().int(),
  description: z.string().min(1),
});
const critUpdateSchema = z.object({ score: z.number().int().optional(), description: z.string().min(1).optional() });

const guard = (req: Request) => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const frameworkId = typeof req.query.frameworkId === "string" ? req.query.frameworkId : undefined;
    const rows = await service.listRequirements(guard(req), frameworkId);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}
export async function get(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getRequirement(guard(req), req.params.id as string)); } catch (e) { next(e); }
}
export async function create(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createRequirement(guard(req), createSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function update(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateRequirement(guard(req), req.params.id as string, updateSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function remove(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteRequirement(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}

export async function listCriteria(req: Request, res: Response, next: NextFunction) {
  try {
    const requirementId = typeof req.query.requirementId === "string" ? req.query.requirementId : undefined;
    if (!requirementId) throw new BadRequestError("requirementId is required", "REQUIREMENT_ID_REQUIRED");
    const rows = await service.listCriteria(guard(req), requirementId);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}
export async function createCriterion(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createCriterion(guard(req), critCreateSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function updateCriterion(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateCriterion(guard(req), req.params.id as string, critUpdateSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function removeCriterion(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteCriterion(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
