import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israScenario.service";
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

export const listScenarios = wrap(async (req, res) => ok(res, await service.listScenarios(guard(req))));
export const getScenarioById = wrap(async (req, res) => ok(res, await service.getScenarioById(guard(req), req.params.id as string)));
// Body schemas mirror israScenario.service.ts's reads; unknown keys (incl. orgId —
// always req.auth's) are stripped.
const text = (max = 500) => z.string().max(max).nullish();
const obj = z.record(z.string(), z.unknown());
const list = z.array(z.unknown()).max(500);
const num = z.number().nullish();
const scenarioFields = {
  title: text(),
  processRef: text(),
  reviewDue: text(40),
  cia: obj.nullish(),
  inherentL: num,
  includedVulns: list.nullish(),
  potentialImpacts: list.nullish(),
};
const createScenarioSchema = z.object({
  ...scenarioFields,
  primaryAssetRef: text(),
  primaryAssetSource: text(60),
  secondaryAssetRef: text(),
  secondaryAssetSource: text(60),
  threatId: text(),
  ciaDesc: obj.nullish(),
  likelihoodNote: text(5000),
});
const updateScenarioSchema = z.object({
  ...scenarioFields,
  status: text(60),
  ciaDesc: obj.nullish(),
  impactOverride: obj.nullish(),
  likelihoodNote: text(5000),
});
const controlSchema = z.object({
  title: text(),
  description: text(10_000),
  objective: text(5000),
  owner: text(),
  status: text(100),
  affects: text(60),
  annexRefs: z.array(z.string().max(100)).max(200).nullish(),
  maturity: obj.nullish(),
  maturityByRef: z.record(z.string(), z.number()).nullish(),
  verified: z.boolean().nullish(),
  verifiedEffectiveness: num,
});
const treatmentSchema = z.object({
  option: text(60),
  rationale: text(10_000),
  approvalStatus: text(60),
  approvedBy: text(200),
  approvalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").nullish(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").nullish(),
  acceptance: obj.nullish(),
});
const dispositionSchema = z.object({ disposition: z.string().max(60), rationale: text(10_000) });
const rtpSchema = z.object({
  // Optional: the RTP form saves partial edits (e.g. monitoring only).
  actions: list.optional(),
  funding: list.nullish(),
  monitoring: text(10_000),
  completionCriteria: text(10_000),
  status: text(60),
  // R337 plan-level fields `saveRtp` persists (`rtpPlanFields`) — stripped here before.
  title: text(),
  description: text(10_000),
  owner: text(),
  supporting: text(2000),
  resources: text(5000),
  startDate: text(40),
  targetDate: text(40),
  expectedEvidence: text(10_000),
  dependencies: text(5000),
  addedControlIds: z.array(z.string().max(100)).max(200).optional(),
});
const residualSchema = z.object({ l: num, L: num, impact: num, score: num, rationale: text(10_000) });
const projectedResidualSchema = z.object({ l: num, L: num, impact: num });

export const createScenario = wrap(async (req, res) => ok(res, await service.createScenario(guard(req), createScenarioSchema.parse(req.body ?? {}), req.ip || null), 201));
export const updateScenario = wrap(async (req, res) => ok(res, await service.updateScenario(guard(req), req.params.id as string, updateScenarioSchema.parse(req.body ?? {}), req.ip || null)));
export const deleteScenario = wrap(async (req, res) => {
  await service.deleteScenario(guard(req), req.params.id as string, req.ip || null);
  ok(res, { deleted: true });
});

export const createExistingControl = wrap(async (req, res) => ok(res, await service.createExistingControl(guard(req), req.params.id as string, controlSchema.parse(req.body ?? {}), req.ip || null), 201));
export const updateExistingControl = wrap(async (req, res) => ok(res, await service.updateExistingControl(guard(req), req.params.controlId as string, controlSchema.parse(req.body ?? {}), req.ip || null)));
export const deleteExistingControl = wrap(async (req, res) => {
  await service.deleteExistingControl(guard(req), req.params.controlId as string, req.ip || null);
  ok(res, { deleted: true });
});

export const saveTreatmentDecision = wrap(async (req, res) => ok(res, await service.saveTreatmentDecision(guard(req), req.params.id as string, treatmentSchema.parse(req.body ?? {}), req.ip || null)));
export const setRecommendationDisposition = wrap(async (req, res) =>
  ok(res, await service.setRecommendationDisposition(guard(req), req.params.id as string, req.params.annexRef as string, dispositionSchema.parse(req.body ?? {}))));
export const generateRecommendations = wrap(async (req, res) => ok(res, await service.generateRecommendations(guard(req), req.params.id as string)));

export const saveRtp = wrap(async (req, res) => ok(res, await service.saveRtp(guard(req), req.params.id as string, rtpSchema.parse(req.body ?? {}), req.ip || null)));
export const approveRtp = wrap(async (req, res) => ok(res, await service.approveRtp(guard(req), req.params.id as string, req.ip || null)));

export const saveResidual = wrap(async (req, res) => ok(res, await service.saveResidual(guard(req), req.params.id as string, residualSchema.parse(req.body ?? {}), req.ip || null)));
export const promoteResidual = wrap(async (req, res) => ok(res, await service.promoteResidual(guard(req), req.params.id as string, req.ip || null)));
// F-302 / OD `isra2StartNextCycle` (js/core.js:14664) and `isra2AcceptRisk`
// (js/core.js:14657) — the two Risk Evaluation actions that move a cycle on.
export const startNextCycle = wrap(async (req, res) => ok(res, await service.startNextCycle(guard(req), req.params.id as string, req.ip || null)));
export const acceptRisk = wrap(async (req, res) => ok(res, await service.acceptRisk(guard(req), req.params.id as string, req.ip || null)));
export const saveProjectedResidual = wrap(async (req, res) => ok(res, await service.saveProjectedResidual(guard(req), req.params.id as string, projectedResidualSchema.parse(req.body ?? {}), req.ip || null)));
