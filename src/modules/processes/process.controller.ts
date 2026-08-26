import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./process.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const processSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  status: z.string().optional(),
});

const stepSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  responsible: z.string().nullish(),
  resources: z.string().nullish(),
  kpi: z.string().nullish(),
  roleId: z.string().uuid().nullish(),
  workUnitId: z.string().uuid().nullish(),
  next: z.array(z.string()).optional(),
});

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listProcesses(guard(req));
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function syncCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.syncCatalog(guard(req), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getProcessById(guard(req), req.params.id as string));
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createProcess(guard(req), processSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateProcess(guard(req), req.params.id as string, processSchema.parse(req.body), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.archiveProcess(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) { next(e); }
}

export async function listSteps(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.listSteps(guard(req), req.params.id as string));
  } catch (e) { next(e); }
}

export async function addStep(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.addStep(guard(req), req.params.id as string, stepSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function updateStep(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateStep(guard(req), req.params.id as string, req.params.stepId as string, stepSchema.parse(req.body), req.ip ?? null));
  } catch (e) { next(e); }
}

export async function deleteStep(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.deleteStep(guard(req), req.params.id as string, req.params.stepId as string, req.ip ?? null));
  } catch (e) { next(e); }
}

export async function raiseStepRisk(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.raiseStepRisk(guard(req), req.params.id as string, req.params.stepId as string, req.body ?? {}, req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function stepRisks(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.stepRisks(guard(req), req.params.id as string, req.params.stepId as string));
  } catch (e) { next(e); }
}
