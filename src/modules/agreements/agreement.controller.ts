import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./agreement.service";
import { AGREEMENT_VARIABLES } from "./variables.catalog";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const blockSchema = z.object({
  id: z.string(),
  type: z.enum(["heading", "paragraph", "clause", "bullet", "divider", "signature"]),
  text: z.string(),
});
const statusSchema = z.enum(["Draft", "Active", "Archived"]);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullish(),
  version: z.string().optional(),
  status: statusSchema.optional(),
  blocks: z.array(blockSchema).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullish(),
  version: z.string().optional(),
  status: statusSchema.optional(),
  blocks: z.array(blockSchema).optional(),
});

const listQuerySchema = z.object({ status: statusSchema.optional() });

export function variables(_req: Request, res: Response): void {
  sendOk(res, AGREEMENT_VARIABLES, 200, { page: 1, limit: AGREEMENT_VARIABLES.length, total: AGREEMENT_VARIABLES.length });
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { status } = listQuerySchema.parse(req.query);
    const rows = await service.listTemplates(req.auth, status);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getTemplate(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createTemplate(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateTemplate(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.duplicateTemplate(req.auth, req.params.id as string, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteTemplate(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
