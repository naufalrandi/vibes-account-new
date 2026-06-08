import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./requirement.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active", "Archived"]);

const createSchema = z.object({
  frameworkId: z.string().uuid(),
  code: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().min(1),
  status: statusSchema.optional(),
});

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: statusSchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const frameworkId = typeof req.query.frameworkId === "string" ? req.query.frameworkId : undefined;
    const rows = await service.listRequirements(req.auth, { frameworkId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getRequirement(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createRequirement(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateRequirement(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteRequirement(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
