import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./frameworkAssignment.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Planned", "Active", "Suspended", "Archived"]);

const createSchema = z.object({
  orgId: z.string().uuid(),
  siteId: z.string().uuid(),
  frameworkId: z.string().uuid(),
  status: statusSchema.optional(),
  assignedDate: z.string().nullish(),
  notes: z.string().nullish(),
});

const updateSchema = z.object({
  status: statusSchema.optional(),
  assignedDate: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const filters = {
      orgId: typeof req.query.orgId === "string" ? req.query.orgId : undefined,
      siteId: typeof req.query.siteId === "string" ? req.query.siteId : undefined,
    };
    const rows = await service.listAssignments(req.auth, filters);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createAssignment(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateAssignment(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteAssignment(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
