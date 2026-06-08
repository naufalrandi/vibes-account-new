import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./implementation.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const createSchema = z.object({
  title: z.string().min(1),
  status: z.string().optional(),
  owner: z.string().nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = createSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const rows = await service.listRecords(req.auth, req.params.module as string, orgId);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getRecord(req.auth, req.params.module as string, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    sendOk(res, await service.createRecord(req.auth, req.params.module as string, input, orgId, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateRecord(req.auth, req.params.module as string, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteRecord(req.auth, req.params.module as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
