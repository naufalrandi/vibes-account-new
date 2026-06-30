import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./billing.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const planSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  billingFrequency: z.enum(["Monthly", "Annual"]).optional(),
  status: z.enum(["Draft", "Active", "Inactive"]).optional(),
});
const paySchema = z.object({ method: z.string().min(1) });

const guard = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function listPlans(_req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listPlans(); sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length }); }
  catch (e) { next(e); }
}
export async function createPlan(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createPlan(guard(req), planSchema.parse(req.body), req.ip ?? null), 201); }
  catch (e) { next(e); }
}
export async function updatePlan(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updatePlan(guard(req), req.params.id as string, planSchema.partial().parse(req.body), req.ip ?? null)); }
  catch (e) { next(e); }
}

function listHandler(fn: (auth: import("../../lib/scope").AuthContext) => Promise<unknown[]>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { const rows = await fn(guard(req)); sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length }); }
    catch (e) { next(e); }
  };
}
export const listSubscriptions = listHandler(service.listSubscriptions);
export const listInvoices = listHandler(service.listInvoices);
export const listPayments = listHandler(service.listPayments);
export const listReceipts = listHandler(service.listReceipts);
export const listRevenueShare = listHandler(service.listRevenueShare);
export const listPayouts = listHandler(service.listPayouts);

export async function payInvoice(req: Request, res: Response, next: NextFunction) {
  try { const { method } = paySchema.parse(req.body); sendOk(res, await service.payInvoice(guard(req), req.params.id as string, method, req.ip ?? null)); }
  catch (e) { next(e); }
}
export async function markPayoutPaid(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.markPayoutPaid(guard(req), req.params.id as string, req.ip ?? null)); }
  catch (e) { next(e); }
}
export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getDashboard(guard(req))); }
  catch (e) { next(e); }
}
