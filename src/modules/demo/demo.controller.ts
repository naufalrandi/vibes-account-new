import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./demo.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import type { DemoApproval, DemoAccessStatus } from "../../db/models/demoTenant.model";

const createSchema = z.object({
  org: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  title: z.string().nullish(),
  country: z.string().nullish(),
  module: z.string().min(1),
  modules: z.array(z.string()).optional(),
  intendedUse: z.string().nullish(),
  role: z.string().optional(),
  validityHours: z.number().int().positive().optional(),
});
const extendSchema = z.object({ validityHours: z.number().int().positive() });

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listDemoTenants(guard(req), {
      approval: req.query.approval as DemoApproval | undefined,
      accessStatus: req.query.accessStatus as DemoAccessStatus | undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
    });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getDemoTenant(guard(req), req.params.id as string)); }
  catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createDemoTenant(guard(req), createSchema.parse(req.body), req.ip ?? null), 201); }
  catch (e) { next(e); }
}

export async function extend(req: Request, res: Response, next: NextFunction) {
  try { const { validityHours } = extendSchema.parse(req.body); sendOk(res, await service.extendDemoTenant(guard(req), req.params.id as string, validityHours, req.ip ?? null)); }
  catch (e) { next(e); }
}

function action(fn: (auth: AuthContext, id: string, ip: string | null) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { sendOk(res, await fn(guard(req), req.params.id as string, req.ip ?? null)); }
    catch (e) { next(e); }
  };
}

export const approve = action(service.approveDemoTenant);
export const reject = action(service.rejectDemoTenant);
export const generate = action(service.generateDemoTenant);
export const resend = action(service.resendDemoTenant);
export const disable = action(service.disableDemoTenant);
export const remove = action(service.deleteDemoTenant);
