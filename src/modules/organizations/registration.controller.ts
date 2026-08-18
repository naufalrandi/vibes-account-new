import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as svc from "./registration.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const proposedSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  email: z.string().email().optional(),
  country: z.string().optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  adminFullName: z.string().min(1),
  adminUsername: z.string().min(1),
  adminEmail: z.string().email(),
});
const rejectSchema = z.object({ reason: z.string().min(1) });
const STATUSES = ["Draft", "Submitted", "Under Review", "PendingApproval", "Approved", "Rejected", "Cancelled"] as const;
const listQuerySchema = z.object({ status: z.enum(STATUSES).optional() });
// `partnerOrgId` is a sibling of the proposed-tenant fields, not part of them —
// null selects OD's "Direct (Service Provider acquisition)" (7713); omitted
// leaves the existing/partner-forced attribution untouched.
const submitSchema = proposedSchema.extend({ asDraft: z.boolean().optional(), partnerOrgId: z.string().uuid().nullish() });
const updateSchema = proposedSchema.partial().extend({ partnerOrgId: z.string().uuid().nullish() });
// Approve/reject are their own decisions, so they are not transition targets.
const transitionSchema = z.object({ status: z.enum(["Submitted", "Under Review", "Cancelled"]) });

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { status } = listQuerySchema.parse(req.query);
    const rows = await svc.listRegistrations(req.auth, status);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { asDraft, partnerOrgId, ...proposed } = submitSchema.parse(req.body);
    sendOk(res, await svc.submitRegistration(req.auth, proposed, req.ip ?? null, asDraft ?? false, partnerOrgId), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { partnerOrgId, ...proposed } = updateSchema.parse(req.body);
    sendOk(res, await svc.updateRegistration(req.auth, String(req.params.id), proposed, req.ip ?? null, partnerOrgId));
  } catch (e) {
    next(e);
  }
}

export async function transition(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { status } = transitionSchema.parse(req.body);
    sendOk(res, await svc.transitionRegistration(req.auth, String(req.params.id), status, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.approveRegistration(req.auth, req.params.id as string, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { reason } = rejectSchema.parse(req.body);
    sendOk(res, await svc.rejectRegistration(req.auth, req.params.id as string, reason, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
