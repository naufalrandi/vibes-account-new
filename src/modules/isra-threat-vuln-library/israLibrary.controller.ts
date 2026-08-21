import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israLibrary.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};
const ip = (req: Request): string | null => req.ip ?? null;

// ---- Annex A ----

export async function listAnnexA(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.listAnnexAControls(typeof req.query.category === "string" ? req.query.category : undefined));
  } catch (e) { next(e); }
}
export async function getAnnexA(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.getAnnexAControl(req.params.ref as string));
  } catch (e) { next(e); }
}
const annexAInputSchema = z.object({
  name: z.string().optional(),
  category: z.string().nullish(),
  csf: z.string().nullish(),
  type: z.string().nullish(),
  fnP: z.boolean().optional(),
  fnD: z.boolean().optional(),
  fnC: z.boolean().optional(),
  dedL: z.boolean().optional(),
  dedC: z.boolean().optional(),
  description: z.string().nullish(),
});
export async function updateAnnexA(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateAnnexAControl(guard(req), req.params.ref as string, annexAInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}

// ---- Threats ----

const catalogQuerySchema = z.object({ category: z.string().optional(), status: z.string().optional() });
const catalogInputSchema = z.object({ name: z.string().optional(), category: z.string().nullish(), description: z.string().nullish(), status: z.string().optional() });

export async function listThreats(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.listThreats(catalogQuerySchema.parse(req.query)));
  } catch (e) { next(e); }
}
export async function getThreat(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.getThreat(req.params.id as string));
  } catch (e) { next(e); }
}
export async function createThreat(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createThreat(guard(req), catalogInputSchema.parse(req.body), ip(req)), 201);
  } catch (e) { next(e); }
}
export async function updateThreat(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateThreat(guard(req), req.params.id as string, catalogInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}
export async function deleteThreat(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteThreat(guard(req), req.params.id as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}

// ---- Vulnerabilities ----

export async function listVulns(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.listVulns(catalogQuerySchema.parse(req.query)));
  } catch (e) { next(e); }
}
export async function getVuln(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.getVuln(req.params.id as string));
  } catch (e) { next(e); }
}
export async function createVuln(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createVuln(guard(req), catalogInputSchema.parse(req.body), ip(req)), 201);
  } catch (e) { next(e); }
}
export async function updateVuln(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateVuln(guard(req), req.params.id as string, catalogInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}
export async function deleteVuln(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteVuln(guard(req), req.params.id as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}

// ---- Knowledge maps ----

export async function listKmSaThreat(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    const q = z.object({ subgroupId: z.string().optional(), threatId: z.string().optional() }).parse(req.query);
    sendOk(res, await service.listKmSaThreat(q));
  } catch (e) { next(e); }
}
export async function listKmThreatVuln(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    const q = z.object({ subgroupId: z.string().optional(), threatId: z.string().optional(), vulnId: z.string().optional() }).parse(req.query);
    sendOk(res, await service.listKmThreatVuln(q));
  } catch (e) { next(e); }
}
export async function listKmVulnControl(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    const q = z.object({ vulnId: z.string().optional(), annexRef: z.string().optional() }).parse(req.query);
    sendOk(res, await service.listKmVulnControl(q));
  } catch (e) { next(e); }
}
export async function getKmMeta(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.getKmMeta());
  } catch (e) { next(e); }
}

// ---- Treat templates ----

export async function listTreatTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    const q = z.object({ vulnId: z.string().optional(), annexRef: z.string().optional() }).parse(req.query);
    sendOk(res, await service.listTreatTemplates(q));
  } catch (e) { next(e); }
}
const treatTemplateInputSchema = z.object({
  vulnId: z.string().optional(),
  annexRef: z.string().optional(),
  actionTemplate: z.string().optional(),
  mechanism: z.string().nullish(),
  notes: z.string().nullish(),
});
export async function createTreatTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createTreatTemplate(guard(req), treatTemplateInputSchema.parse(req.body), ip(req)), 201);
  } catch (e) { next(e); }
}
export async function updateTreatTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.updateTreatTemplate(guard(req), req.params.id as string, treatTemplateInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}
export async function deleteTreatTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteTreatTemplate(guard(req), req.params.id as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}

// ---- utilities ----

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    guard(req);
    sendOk(res, await service.listLibraryCategories());
  } catch (e) { next(e); }
}
