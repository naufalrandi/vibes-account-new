import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./criterion.service";
import { sendOk } from "../../lib/apiResponse";
import { BadRequestError, UnauthorizedError } from "../../lib/errors";

const createSchema = z.object({
  requirementId: z.string().uuid(),
  score: z.number().int().min(0).max(9),
  description: z.string().min(1),
});
const updateSchema = z.object({
  score: z.number().int().min(0).max(9).optional(),
  description: z.string().min(1).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const requirementId = typeof req.query.requirementId === "string" ? req.query.requirementId : undefined;
    if (!requirementId) throw new BadRequestError("requirementId is required", "REQUIREMENT_ID_REQUIRED");
    const rows = await service.listCriteria(req.auth, requirementId);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createCriterion(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateCriterion(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteCriterion(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
