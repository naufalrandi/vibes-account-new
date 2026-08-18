import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./partner.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { PartnerStatus } from "../../db/models/partnerProfile.model";

const tierSchema = z.enum(["Bronze", "Silver", "Gold"]);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  tier: tierSchema.optional(),
  admin: z.object({ fullName: z.string().min(1), username: z.string().min(1), email: z.string().email() }),
  mode: z.enum(["draft", "send"]).optional(),
  agreement: z.object({ templateId: z.string().uuid(), vars: z.record(z.string(), z.string()).optional() }).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  tier: tierSchema.optional(),
});

const generateSchema = z.object({
  templateId: z.string().uuid(),
  vars: z.record(z.string(), z.string()).optional(),
});

const listQuerySchema = z.object({
  status: z
    .enum(["Draft", "Pending Approval", "Approved", "Active", "Suspended", "Terminated"])
    .optional(),
  country: z.string().optional(),
  search: z.string().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const filters = listQuerySchema.parse(req.query);
    const rows = await service.listPartners(req.auth, filters as { status?: PartnerStatus; country?: string; search?: string });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getPartner(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function team(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const d = await service.getPartnerTeam(req.auth, req.params.id as string);
    sendOk(res, d, 200, { page: 1, limit: d.length, total: d.length });
  } catch (e) { next(e); }
}
export async function tenants(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const d = await service.getPartnerTenants(req.auth, req.params.id as string);
    sendOk(res, d, 200, { page: 1, limit: d.length, total: d.length });
  } catch (e) { next(e); }
}
export async function billing(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getPartnerBilling(req.auth, req.params.id as string));
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createPartner(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updatePartner(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

function lifecycle(fn: (auth: import("../../lib/scope").AuthContext, id: string, ip: string | null) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      sendOk(res, await fn(req.auth, req.params.id as string, req.ip ?? null));
    } catch (e) {
      next(e);
    }
  };
}

export const resendActivation = lifecycle(service.resendPartnerActivation);
export const activate = lifecycle(service.activatePartner);
export const suspend = lifecycle(service.suspendPartner);
export const resume = lifecycle(service.resumePartner);
export const terminate = lifecycle(service.terminatePartner);

export async function getAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getPartnerAgreement(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = generateSchema.parse(req.body);
    sendOk(res, await service.generateAgreement(req.auth, req.params.id as string, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export const regenerate = lifecycle(service.regenerateAgreement);
export const resend = lifecycle(service.resendAgreement);
export const approve = lifecycle(service.approveAgreement);
