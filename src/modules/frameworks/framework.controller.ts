import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./framework.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Published", "Active", "Archived"]);
// Accept an ISO date ("YYYY-MM-DD") or null; the column is DATEONLY.
const publishedDateSchema = z.string().min(1).nullish();

// One schema covering both the catalog shape (code+familyId) and the meta-model
// shape (groupId+jurisdictions+description). The service picks the path by which
// identifying field is present.
const createSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  familyId: z.string().uuid().optional(),
  version: z.string().nullish(),
  status: statusSchema.optional(),
  publishedDate: publishedDateSchema,
  shortDescription: z.string().nullish(),
  fullDescription: z.string().nullish(),
  groupId: z.string().uuid().optional(),
  description: z.string().nullish(),
  jurisdictions: z.array(z.string()).optional(),
  shortLabel: z.string().nullish(),
});

const updateSchema = createSchema.partial();

export async function groups(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listGroups(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    // Optional ?familyId / ?groupId narrows the list.
    const familyId = typeof req.query.familyId === "string" ? req.query.familyId : undefined;
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
    const rows = await service.listFrameworks(req.auth, { familyId, groupId });
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
