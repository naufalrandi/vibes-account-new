import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./doaMatrix.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const inputSchema = z.object({
  type: z.string().optional(),
  max: z.number().nullish(),
  currency: z.string().optional(),
  approver: z.string().optional(),
  approverKind: z.enum(["role", "user", "auto"]).optional(),
  finance: z.boolean().optional(),
  quotes: z.boolean().optional(),
});

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listEntries(guard(req));
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createEntry(guard(req), inputSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateEntry(guard(req), req.params.id as string, inputSchema.parse(req.body), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteEntry(guard(req), req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) { next(e); }
}

const methodSchema = z.object({
  type: z.string().min(1),
  method: z.string(),
});

export async function listMethods(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listMethods(guard(req));
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function setMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const input = methodSchema.parse(req.body);
    sendOk(res, await service.setMethod(guard(req), input.type, input.method, req.ip ?? null));
  } catch (e) { next(e); }
}
