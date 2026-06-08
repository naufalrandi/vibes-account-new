import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./site.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const typeSchema = z.enum([
  "Head Office",
  "Branch Office",
  "Factory",
  "Warehouse",
  "Data Center",
  "Subsidiary",
  "Business Unit",
  "Other",
]);
const statusSchema = z.enum(["Active", "Inactive"]);

const createSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1),
  type: typeSchema.optional(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  status: statusSchema.optional(),
  isPrimary: z.boolean().optional(),
  description: z.string().nullish(),
  contactPerson: z.string().nullish(),
  contactEmail: z.string().nullish(),
  contactPhone: z.string().nullish(),
});

const updateSchema = createSchema.partial().omit({ orgId: true });

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const rows = await service.listSites(req.auth, { orgId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getSite(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createSite(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateSite(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteSite(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
