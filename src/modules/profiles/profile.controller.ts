import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./profile.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Active", "Inactive"]);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  status: statusSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: statusSchema.optional(),
});

const listQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: statusSchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const filters = listQuerySchema.parse(req.query);
    const { rows, total } = await service.listProfiles(req.auth, filters);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createProfile(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateProfile(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteProfile(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
