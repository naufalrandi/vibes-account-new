import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./workUnit.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const inputSchema = z.object({
  name: z.string().optional(),
  siteId: z.string().uuid().nullish(),
  status: z.string().optional(),
  description: z.string().nullish(),
  processIds: z.array(z.string()).optional(),
  envIds: z.array(z.string()).optional(),
  depIds: z.array(z.string()).optional(),
});

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listWorkUnits(guard(req));
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createWorkUnit(guard(req), inputSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateWorkUnit(guard(req), req.params.id as string, inputSchema.parse(req.body), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.archiveWorkUnit(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) { next(e); }
}
