import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./lims.service";
import { workflowConfig } from "./limsEngine";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const stageState = z.enum(["Mandatory", "Optional", "Not Applicable"]);
const stagesSchema = z.record(z.string(), stageState);
const createSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().nullish(),
  status: z.enum(["Active", "Inactive"]).optional(),
  stages: stagesSchema.optional(),
});

export async function listServices(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const rows = await service.listServices(req.auth, { orgId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function getService(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getService(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function createService(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    sendOk(res, await service.createService(req.auth, input, orgId, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updateService(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.updateService(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function removeService(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteService(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

export function getWorkflowConfig(_req: Request, res: Response) {
  sendOk(res, workflowConfig());
}

export async function preview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const serviceId = typeof req.query.serviceId === "string" ? req.query.serviceId : "";
    const raw = req.query.optional;
    const selected = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? raw.split(",") : [];
    sendOk(res, await service.previewWorkflow(req.auth, serviceId, selected));
  } catch (e) {
    next(e);
  }
}
