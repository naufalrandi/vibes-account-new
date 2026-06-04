import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./frameworkFamily.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Active", "Inactive"]);

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  frameworkTypeId: z.string().uuid(),
  sortOrder: z.number().int().optional(),
  status: statusSchema.optional(),
  description: z.string().nullish(),
});

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  frameworkTypeId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
  status: statusSchema.optional(),
  description: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    // Optional ?typeId=<uuid> narrows the list to one parent type.
    const typeId = typeof req.query.typeId === "string" ? req.query.typeId : undefined;
    const rows = await service.listFrameworkFamilies(req.auth, { frameworkTypeId: typeId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createFrameworkFamily(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateFrameworkFamily(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteFrameworkFamily(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
