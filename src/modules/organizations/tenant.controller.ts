import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as tenantService from "./tenant.service";
import * as provisioning from "./provisioning.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const siteTypeSchema = z.enum([
  "Head Office",
  "Branch Office",
  "Factory",
  "Warehouse",
  "Data Center",
  "Subsidiary",
  "Business Unit",
  "Other",
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
  admin: z.object({
    fullName: z.string().min(1),
    username: z.string().min(1),
    email: z.string().email(),
  }),
  mode: z.enum(["draft", "activate"]),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await tenantService.listTenants(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await tenantService.getTenant(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = provisionSchema.parse(req.body);
    sendOk(res, await provisioning.provisionTenant(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

type LifecycleVerb =
  | "sendActivation"
  | "resendActivation"
  | "activateTenant"
  | "suspendTenant"
  | "resumeTenant"
  | "deactivateTenant"
  | "reactivateTenant";

function lifecycle(verb: LifecycleVerb) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await tenantService[verb](req.auth, req.params.id as string, req.ip ?? null);
      sendOk(res, result);
    } catch (e) {
      next(e);
    }
  };
}

export const sendActivation = lifecycle("sendActivation");
export const resendActivation = lifecycle("resendActivation");
export const activate = lifecycle("activateTenant");
export const suspend = lifecycle("suspendTenant");
export const resume = lifecycle("resumeTenant");
export const deactivate = lifecycle("deactivateTenant");
export const reactivate = lifecycle("reactivateTenant");
