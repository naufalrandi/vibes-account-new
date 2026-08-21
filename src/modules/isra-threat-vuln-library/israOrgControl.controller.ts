import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israOrgControl.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};
const ip = (req: Request): string | null => req.ip ?? null;

// ---- Org Controls ----

export async function listControls(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.listEffectiveControls(guard(req)));
  } catch (e) { next(e); }
}
export async function getControl(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getEffectiveControl(guard(req), req.params.ref as string));
  } catch (e) { next(e); }
}
const orgControlInputSchema = z.object({
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
export async function upsertControl(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.upsertOrgControl(guard(req), req.params.ref as string, orgControlInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}
export async function deleteControl(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteOrgControl(guard(req), req.params.ref as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}

// ---- Maturity baselines ----

export async function listMaturityBaselines(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.listMaturityBaselines(guard(req)));
  } catch (e) { next(e); }
}
const maturityInputSchema = z.object({
  gov: z.number().int().nullish(),
  doc: z.number().int().nullish(),
  impl: z.number().int().nullish(),
  mon: z.number().int().nullish(),
  comp: z.number().int().nullish(),
});
export async function upsertMaturityBaseline(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.upsertMaturityBaseline(guard(req), req.params.annexRef as string, maturityInputSchema.parse(req.body), ip(req)));
  } catch (e) { next(e); }
}
export async function deleteMaturityBaseline(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteMaturityBaseline(guard(req), req.params.annexRef as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}

// ---- Vuln→Control overlay ----

export async function listVulnControlOverlay(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.listVulnControlOverlay(guard(req)));
  } catch (e) { next(e); }
}
const overlayInputSchema = z.object({
  kind: z.string(),
  edgeId: z.string().nullish(),
  vulnId: z.string().nullish(),
  annexRef: z.string().nullish(),
  role: z.string().nullish(),
  affects: z.string().nullish(),
  strength: z.string().nullish(),
  mechanism: z.string().nullish(),
});
export async function createVulnControlOverlay(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createVulnControlOverlay(guard(req), overlayInputSchema.parse(req.body), ip(req)), 201);
  } catch (e) { next(e); }
}
export async function deleteVulnControlOverlay(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteVulnControlOverlay(guard(req), req.params.id as string, ip(req));
    sendOk(res, null);
  } catch (e) { next(e); }
}
export async function listEffectiveVulnControlMap(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.listEffectiveVulnControlMap(guard(req)));
  } catch (e) { next(e); }
}
