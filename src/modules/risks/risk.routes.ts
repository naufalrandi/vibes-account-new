import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import * as svc from "./risk.service";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import { sendOk } from "../../lib/apiResponse";
import { requireAction, requireAnyAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

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

export const riskRoutes = Router();

// The Risk Register is a Management System register (FE `/implementation/risks`),
// so it rides the same grants as the other clause registers. RTP approval steps
// also accept the Approvals module's approver grant.
const READ = requireAction(ACTIONS.MS_READ);
const MANAGE = requireAction(ACTIONS.MS_MANAGE);
const APPROVE = requireAnyAction(ACTIONS.MS_MANAGE, ACTIONS.APPROVAL_APPROVE);

// Body schemas mirror what risk.service.ts reads. Unknown keys are stripped —
// notably `orgId`: a risk is always created in the caller's own org (req.auth).
const text = (max: number) => z.string().max(max);
const idList = z.array(text(200)).max(200);
const score = z.number().min(0).max(100).nullish();
const riskFields = {
  title: text(500).optional(),
  description: text(10_000).optional(),
  category: text(200).optional(),
  domains: idList.optional(),
  frameworks: idList.optional(),
  source: text(200).optional(),
  methodology: z.enum(["basic", "quant"]).optional(),
  likelihood: score,
  impact: score,
  priority: z.enum(["High", "Medium", "Low"]).nullish(),
  owner: text(200).nullish(),
};
const createRiskSchema = z.object({
  ...riskFields,
  sourceIssueId: text(200).nullish(),
  sourceReqId: text(200).nullish(),
  processId: text(200).nullish(),
  stepId: text(200).nullish(),
  issueCategory: text(200).nullish(),
});
const updateRiskSchema = z.object({ ...riskFields, status: text(60).optional() });
const configSchema = z.object({
  riskMethod: z.enum(["basic", "quant"]).optional(),
  riskLevels: z.object({ names: z.array(text(60)).length(4), bounds: z.array(z.number()).length(3) }).optional(),
  riskAppetite: z.number().int().min(1).max(25).optional(),
});
const assignSchema = z.object({ owner: text(200).default(""), note: text(2000).optional() });
const resourceSchema = z.looseObject({
  id: text(100),
  title: text(500),
  desc: text(2000).optional(),
  budget: z.coerce.number().min(0),
  currency: text(10),
});
const actionPlanFields = {
  deadline: text(40).optional(),
  resources: z.array(resourceSchema).max(100).optional(),
  pics: idList.optional(),
};
const createActionPlanSchema = z.object({
  ...actionPlanFields,
  title: z.string().trim().min(1).max(500),
  status: z.enum(["Draft", "Planned", "In Progress", "Completed"]).optional(),
});
const updateActionPlanSchema = z.object({
  ...actionPlanFields,
  title: z.string().trim().min(1).max(500).optional(),
  status: z.enum(["Draft", "Planned", "In Progress", "Completed", "Verified"]).optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

riskRoutes.get(
  "/",
  READ,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.listRisks(auth, {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      orgId: typeof req.query.orgId === "string" ? req.query.orgId : undefined,
    });
    ok(res, data);
  })
);

riskRoutes.get(
  "/config",
  READ,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.getTenantRiskConfig(auth, typeof req.query.orgId === "string" ? req.query.orgId : undefined);
    ok(res, data);
  })
);

riskRoutes.put(
  "/config",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateTenantRiskConfig(auth, configSchema.parse(req.body ?? {}), req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.get(
  "/:id",
  READ,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.getRiskById(auth, req.params.id as string);
    ok(res, data);
  })
);

riskRoutes.post(
  "/",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.createRisk(auth, createRiskSchema.parse(req.body ?? {}), req.ip ?? null);
    ok(res, data, 201);
  })
);

riskRoutes.put(
  "/:id",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateRisk(auth, req.params.id as string, updateRiskSchema.parse(req.body ?? {}), req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.delete(
  "/:id",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.deleteRisk(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/archive",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.archiveRisk(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/assign",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const { owner, note } = assignSchema.parse(req.body ?? {});
    const data = await svc.assignOwner(auth, req.params.id as string, owner, req.ip ?? null, note);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/generate",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.generateRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/action-plans",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.addActionPlan(auth, req.params.id as string, createActionPlanSchema.parse(req.body ?? {}), req.ip ?? null);
    ok(res, data, 201);
  })
);

riskRoutes.put(
  "/:id/rtp/action-plans/:apId",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateActionPlan(
      auth,
      req.params.id as string,
      req.params.apId as string,
      updateActionPlanSchema.parse(req.body ?? {}),
      req.ip ?? null
    );
    ok(res, data);
  })
);

riskRoutes.delete(
  "/:id/rtp/action-plans/:apId",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.deleteActionPlan(auth, req.params.id as string, req.params.apId as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/propose",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.proposeRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve",
  APPROVE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve-ms",
  APPROVE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtpMS(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve-tm",
  APPROVE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtpTM(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/reject",
  APPROVE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.rejectRtp(auth, req.params.id as string, rejectSchema.parse(req.body ?? {}).reason, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/escalate",
  APPROVE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.escalateRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/action-plans/:apId/verify",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.verifyActionPlan(
      auth,
      req.params.id as string,
      req.params.apId as string,
      req.ip ?? null
    );
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/complete",
  MANAGE,
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.completeTreatment(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);
