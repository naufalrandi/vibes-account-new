import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./framework.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Active", "Archived"]);

const createSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullish(),
  jurisdictions: z.array(z.string()).optional(),
  status: statusSchema.optional(),
});

const updateSchema = z.object({
  groupId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  jurisdictions: z.array(z.string()).optional(),
  status: statusSchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
    const rows = await service.listFrameworks(req.auth, { groupId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getFramework(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createFramework(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateFramework(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteFramework(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
