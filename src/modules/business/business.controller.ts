import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./business.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const inputSchema = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  owner: z.string().nullish(),
  company: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const company = (req.query.company as string) || (req.headers["x-company"] as string);
    const rows = await service.listBusiness(guard(req), req.params.area as string, req.params.module as string, company);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const input = inputSchema.parse(req.body);
    sendOk(res, await service.createBusiness(guard(req), req.params.area as string, req.params.module as string, input, req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const input = inputSchema.parse(req.body);
    sendOk(res, await service.updateBusiness(guard(req), req.params.area as string, req.params.module as string, req.params.id as string, input, req.ip ?? null));
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteBusiness(guard(req), req.params.area as string, req.params.module as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) { next(e); }
}
