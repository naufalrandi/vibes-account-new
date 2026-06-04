import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./framework.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Published", "Archived"]);
// Accept an ISO date ("YYYY-MM-DD") or null; the column is DATEONLY.
const publishedDateSchema = z.string().min(1).nullish();

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  familyId: z.string().uuid(),
  version: z.string().nullish(),
  status: statusSchema.optional(),
  publishedDate: publishedDateSchema,
  shortDescription: z.string().nullish(),
  fullDescription: z.string().nullish(),
});

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  familyId: z.string().uuid().optional(),
  version: z.string().nullish(),
  status: statusSchema.optional(),
  publishedDate: publishedDateSchema,
  shortDescription: z.string().nullish(),
  fullDescription: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    // Optional ?familyId=<uuid> narrows the list to one parent family.
    const familyId = typeof req.query.familyId === "string" ? req.query.familyId : undefined;
    const rows = await service.listFrameworks(req.auth, { familyId });
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
