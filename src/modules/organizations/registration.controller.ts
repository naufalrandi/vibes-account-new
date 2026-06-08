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
  adminFullName: z.string().min(1),
  adminUsername: z.string().min(1),
  adminEmail: z.string().email(),
});
const rejectSchema = z.object({ reason: z.string().min(1) });

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as "PendingApproval" | "Approved" | "Rejected")
        : undefined;
    const rows = await svc.listRegistrations(req.auth, { status });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.submitRegistration(req.auth, proposedSchema.parse(req.body), req.ip ?? null), 201);
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
