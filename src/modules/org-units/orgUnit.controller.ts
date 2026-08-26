import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./orgUnit.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const inputSchema = z.object({
  name: z.string().optional(),
  parentId: z.string().uuid().nullish(),
  appt: z.record(z.string(), z.string().nullable()).optional(),
});

const reparentSchema = z.object({
  parentId: z.string().uuid().nullable(),
  dryRun: z.boolean().optional(),
});

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listOrgUnits(guard(req));
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { parentId, ...rest } = inputSchema.parse(req.body);
    sendOk(res, await service.createOrgUnit(guard(req), { ...rest, parentId: parentId ?? null }, req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateOrgUnit(guard(req), req.params.id as string, inputSchema.parse(req.body), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteOrgUnit(guard(req), req.params.id as string, req.ip ?? null);
    sendOk(res, { deleted: true });
  } catch (e) { next(e); }
}

export async function members(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listOrgUnitMembers(guard(req), req.params.id as string);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function reparent(req: Request, res: Response, next: NextFunction) {
  try {
    const { parentId, dryRun } = reparentSchema.parse(req.body);
    const auth = guard(req);
    if (dryRun) {
      sendOk(res, await service.previewReparentOrgUnit(auth, req.params.id as string, parentId));
      return;
    }
    const { unit, preview } = await service.reparentOrgUnit(auth, req.params.id as string, parentId, req.ip ?? null);
    sendOk(res, { unit, impacts: preview.impacts, affected: preview.affected });
  } catch (e) { next(e); }
}
