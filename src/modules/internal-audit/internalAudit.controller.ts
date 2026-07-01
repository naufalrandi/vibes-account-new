import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./internalAudit.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
const statusSchema = z.object({ status: z.string().min(1).max(80) });
const reviewSchema = z.object({
  decision: z.string().min(1).max(80),
  type: z.string().max(80).optional(),
  pic: z.string().max(200).nullish(),
  due: z.string().max(40).nullish(),
  reviewNotes: z.string().max(4000).nullish(),
});
const routeSchema = z.object({ target: z.enum(["nc", "imp"]) });

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const orgOf = (req: Request) => (typeof req.query.orgId === "string" ? req.query.orgId : undefined);
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Settings
export const getSettings = wrap(async (req, res) => ok(res, await service.getSettings(guard(req), orgOf(req))));
export const updateSettings = wrap(async (req, res) => ok(res, await service.updateSettings(guard(req), body.parse(req.body), orgOf(req), ip(req))));

// Programs
export const listPrograms = wrap(async (req, res) => ok(res, await service.listPrograms(guard(req), orgOf(req))));
export const createProgram = wrap(async (req, res) => ok(res, await service.createProgram(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const updateProgram = wrap(async (req, res) => ok(res, await service.updateProgram(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setProgramStatus = wrap(async (req, res) => ok(res, await service.setProgramStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));

// Plans
export const listPlans = wrap(async (req, res) => ok(res, await service.listPlans(guard(req), orgOf(req))));
export const createPlan = wrap(async (req, res) => ok(res, await service.createPlan(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const updatePlan = wrap(async (req, res) => ok(res, await service.updatePlan(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setPlanStatus = wrap(async (req, res) => ok(res, await service.setPlanStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));

// Sessions
export const listSessions = wrap(async (req, res) => ok(res, await service.listSessions(guard(req), orgOf(req))));
export const createSession = wrap(async (req, res) => ok(res, await service.createSession(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const updateSession = wrap(async (req, res) => ok(res, await service.updateSession(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setSessionStatus = wrap(async (req, res) => ok(res, await service.setSessionStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));

// Findings
export const listFindings = wrap(async (req, res) => ok(res, await service.listFindings(guard(req), orgOf(req))));
export const createFinding = wrap(async (req, res) => ok(res, await service.createFinding(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const updateFinding = wrap(async (req, res) => ok(res, await service.updateFinding(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const reviewFinding = wrap(async (req, res) => {
  const b = reviewSchema.parse(req.body);
  ok(res, await service.reviewFinding(guard(req), req.params.id as string, b.decision, b, ip(req)));
});
export const issueFinding = wrap(async (req, res) => ok(res, await service.issueFinding(guard(req), req.params.id as string, ip(req))));
export const routeFinding = wrap(async (req, res) => ok(res, await service.routeFinding(guard(req), req.params.id as string, routeSchema.parse(req.body).target, ip(req))));

// Reports
export const listReports = wrap(async (req, res) => ok(res, await service.listReports(guard(req), orgOf(req))));
export const generateReport = wrap(async (req, res) => ok(res, await service.generateReport(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const setReportStatus = wrap(async (req, res) => ok(res, await service.setReportStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
