import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./fwrc.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const createSchema = z.object({
  requirementId: z.string().uuid(),
  responseId: z.string().uuid(),
  statement: z.string().min(1),
  status: z.enum(["Active", "Inactive"]).optional(),
});
const updateSchema = z.object({
  responseId: z.string().uuid().optional(),
  statement: z.string().min(1).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const guard = (req: Request): AuthContext => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listFwrc(guard(req), {
      requirementId: req.query.requirementId as string | undefined,
      elementId: req.query.elementId as string | undefined,
      frameworkId: req.query.frameworkId as string | undefined,
      responseId: req.query.responseId as string | undefined,
    });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}
export async function create(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createFwrc(guard(req), createSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function update(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateFwrc(guard(req), req.params.id as string, updateSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function remove(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteFwrc(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
