import { Router, type Request, type Response, type NextFunction } from "express";
import * as svc from "./risk.service";
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

export const riskRoutes = Router();

riskRoutes.get(
  "/",
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
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.getTenantRiskConfig(auth, typeof req.query.orgId === "string" ? req.query.orgId : undefined);
    ok(res, data);
  })
);

riskRoutes.put(
  "/config",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateTenantRiskConfig(auth, req.body ?? {}, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.get(
  "/:id",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.getRiskById(auth, req.params.id as string);
    ok(res, data);
  })
);

riskRoutes.post(
  "/",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.createRisk(auth, req.body ?? {}, req.ip ?? null);
    ok(res, data, 201);
  })
);

riskRoutes.put(
  "/:id",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateRisk(auth, req.params.id as string, req.body ?? {}, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.delete(
  "/:id",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.deleteRisk(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/archive",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.archiveRisk(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/assign",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.assignOwner(auth, req.params.id as string, String(req.body?.owner || ""), req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/generate",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.generateRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/action-plans",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.addActionPlan(auth, req.params.id as string, req.body ?? {}, req.ip ?? null);
    ok(res, data, 201);
  })
);

riskRoutes.put(
  "/:id/rtp/action-plans/:apId",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.updateActionPlan(
      auth,
      req.params.id as string,
      req.params.apId as string,
      req.body ?? {},
      req.ip ?? null
    );
    ok(res, data);
  })
);

riskRoutes.delete(
  "/:id/rtp/action-plans/:apId",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.deleteActionPlan(auth, req.params.id as string, req.params.apId as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/propose",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.proposeRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve-ms",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtpMS(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/approve-tm",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.approveRtpTM(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/reject",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.rejectRtp(auth, req.params.id as string, String(req.body?.reason || ""), req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/escalate",
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.escalateRtp(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);

riskRoutes.post(
  "/:id/rtp/action-plans/:apId/verify",
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
  wrap(async (req, res) => {
    const auth = guard(req);
    const data = await svc.completeTreatment(auth, req.params.id as string, req.ip ?? null);
    ok(res, data);
  })
);
