import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as orgService from "./organization.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const createSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["Distributor", "Tenant"]),
  email: z.string().email().nullish(),
  country: z.string().nullish(),
  parentOrgId: z.string().uuid().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgs = await orgService.listOrganizations(req.auth);
    sendOk(res, orgs, 200, { page: 1, limit: orgs.length, total: orgs.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await orgService.getOrganization(req.auth, req.params.id));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await orgService.createOrganization(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await orgService.activateOrganization(req.auth, req.params.id, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function suspend(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await orgService.suspendOrganization(req.auth, req.params.id, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
