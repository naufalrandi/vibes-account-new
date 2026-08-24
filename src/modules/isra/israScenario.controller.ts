import type { Request, Response, NextFunction } from "express";
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
export const createScenario = wrap(async (req, res) => ok(res, await service.createScenario(guard(req), req.body, req.ip || null), 201));
export const updateScenario = wrap(async (req, res) => ok(res, await service.updateScenario(guard(req), req.params.id as string, req.body, req.ip || null)));
export const deleteScenario = wrap(async (req, res) => {
  await service.deleteScenario(guard(req), req.params.id as string, req.ip || null);
  ok(res, { deleted: true });
});

export const createExistingControl = wrap(async (req, res) => ok(res, await service.createExistingControl(guard(req), req.params.id as string, req.body, req.ip || null), 201));
export const updateExistingControl = wrap(async (req, res) => ok(res, await service.updateExistingControl(guard(req), req.params.controlId as string, req.body, req.ip || null)));
export const deleteExistingControl = wrap(async (req, res) => {
  await service.deleteExistingControl(guard(req), req.params.controlId as string, req.ip || null);
  ok(res, { deleted: true });
});

export const saveTreatmentDecision = wrap(async (req, res) => ok(res, await service.saveTreatmentDecision(guard(req), req.params.id as string, req.body, req.ip || null)));
export const generateRecommendations = wrap(async (req, res) => ok(res, await service.generateRecommendations(guard(req), req.params.id as string)));

export const saveRtp = wrap(async (req, res) => ok(res, await service.saveRtp(guard(req), req.params.id as string, req.body, req.ip || null)));
export const approveRtp = wrap(async (req, res) => ok(res, await service.approveRtp(guard(req), req.params.id as string, req.ip || null)));

export const saveResidual = wrap(async (req, res) => ok(res, await service.saveResidual(guard(req), req.params.id as string, req.body, req.ip || null)));
export const promoteResidual = wrap(async (req, res) => ok(res, await service.promoteResidual(guard(req), req.params.id as string, req.ip || null)));
export const saveProjectedResidual = wrap(async (req, res) => ok(res, await service.saveProjectedResidual(guard(req), req.params.id as string, req.body, req.ip || null)));
