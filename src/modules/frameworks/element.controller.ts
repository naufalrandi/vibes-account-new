import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./element.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active", "Archived"]);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  status: statusSchema.optional(),
});
const updateSchema = createSchema.partial();
const mappingsSchema = z.object({ requirementIds: z.array(z.string().uuid()) });

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listElements(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getElement(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createElement(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateElement(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteElement(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

export async function setMappings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { requirementIds } = mappingsSchema.parse(req.body);
    sendOk(res, await service.setElementMappings(req.auth, req.params.id as string, requirementIds, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
