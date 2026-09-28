import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israSupport.service";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import { sendOk } from "../../lib/apiResponse";

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

const ok = (res: Response, data: unknown, code = 200) => sendOk(res, data, code);
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };

export const getOrgSettings = wrap(async (req, res) => ok(res, await service.getOrgSettings(guard(req))));
// Body schemas mirror israSupport.service.ts's reads; unknown keys (incl. orgId) are stripped.
const obj = z.record(z.string(), z.unknown());
const orgSettingsSchema = z.object({
  matrix: z.union([obj, z.string().max(20)]).nullish(),
  riskLevels: z.array(z.string().max(60)).max(10).nullish(),
  conseqMethod: z.string().max(60).nullish(),
  ciaSeverityMap: obj.nullish(),
  conseqCiaRelation: obj.nullish(),
  reviewFreq: z.string().max(60).nullish(),
  reviewPeriodAboveMonths: z.number().int().min(0).max(120).nullish(),
  reviewPeriodWithinMonths: z.number().int().min(0).max(120).nullish(),
  autoRec: z.boolean().optional(),
  overrideAllowed: z.boolean().optional(),
  requireAccept: z.boolean().optional(),
  requireHigher: z.boolean().optional(),
  residualEnabled: z.boolean().optional(),
});
const appetiteSchema = z.object({
  threshold: z.number().min(1).max(25).nullish(),
  rationale: z.string().max(5000).nullish(),
  approvedBy: z.string().max(200).nullish(),
  approvalDate: z.string().max(40).nullish(),
  effectiveDate: z.string().max(40).nullish(),
});

export const saveOrgSettings = wrap(async (req, res) => ok(res, await service.saveOrgSettings(guard(req), orgSettingsSchema.parse(req.body ?? {}), req.ip || null)));
export const getAppetiteLog = wrap(async (req, res) => ok(res, await service.getAppetiteLog(guard(req))));
export const logAppetite = wrap(async (req, res) => ok(res, await service.logAppetite(guard(req), appetiteSchema.parse(req.body ?? {}), req.ip || null), 201));
export const validateIntegrity = wrap(async (req, res) => ok(res, await service.validateIntegrity(guard(req))));
