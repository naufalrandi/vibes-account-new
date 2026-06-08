import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as plans from "./plan.service";
import * as billing from "./billing.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const planSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  billingFrequency: z.enum(["Monthly", "Annual"]).optional(),
  status: z.enum(["Draft", "Active", "Inactive"]).optional(),
});

function listHandler<T>(fn: (auth: NonNullable<Request["auth"]>) => Promise<T[]>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const rows = await fn(req.auth);
      sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
    } catch (e) {
      next(e);
    }
  };
}

export const listPlans = listHandler(plans.listPlans);
export const listSubscriptions = listHandler(billing.listSubscriptions);
export const listInvoices = listHandler(billing.listInvoices);
export const listPayments = listHandler(billing.listPayments);
export const listReceipts = listHandler(billing.listReceipts);
export const listRevenueShare = listHandler(billing.listRevenueShare);
export const listPayouts = listHandler(billing.listPayouts);

export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await billing.getDashboard(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function createPlan(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await plans.createPlan(req.auth, planSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updatePlan(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await plans.updatePlan(req.auth, req.params.id as string, planSchema.partial().parse(req.body), req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
