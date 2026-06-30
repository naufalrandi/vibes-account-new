import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./tenant.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const siteTypeSchema = z.enum([
  "Head Office", "Branch Office", "Factory", "Warehouse",
  "Data Center", "Subsidiary", "Business Unit", "Other",
]);

const provisionSchema = z.object({
  organization: z.object({
    name: z.string().min(1),
    code: z.string().optional(),
    legalName: z.string().nullish(),
    industry: z.string().nullish(),
    email: z.string().email().nullish(),
    phone: z.string().nullish(),
    website: z.string().nullish(),
    country: z.string().nullish(),
    address: z.string().nullish(),
    partnerOrgId: z.string().uuid().nullish(),
  }),
  primarySite: z.object({
    name: z.string().min(1),
    type: siteTypeSchema.optional(),
    country: z.string().nullish(),
    address: z.string().nullish(),
  }),
  admin: z.object({ fullName: z.string().min(1), username: z.string().min(1), email: z.string().email() }),
  mode: z.enum(["draft", "activate"]),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listTenants(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getTenant(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = provisionSchema.parse(req.body);
    sendOk(res, await service.provisionTenant(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

function lifecycle(fn: (auth: AuthContext, id: string, ip: string | null) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      sendOk(res, await fn(req.auth, req.params.id as string, req.ip ?? null));
    } catch (e) {
      next(e);
    }
  };
}

export const sendActivation = lifecycle(service.sendActivation);
export const resendActivation = lifecycle(service.resendActivation);
export const activate = lifecycle(service.activate);
export const suspend = lifecycle(service.suspend);
export const resume = lifecycle(service.resume);
export const deactivate = lifecycle(service.deactivate);
export const reactivate = lifecycle(service.reactivate);
