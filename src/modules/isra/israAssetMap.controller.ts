import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israAssetMap.service";
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

export const getAssetMapTree = wrap(async (req, res) => ok(res, await service.getAssetMapTree(guard(req))));
// Body schemas mirror israAssetMap.service.ts's reads; unknown keys (incl. orgId) are stripped.
const ref = z.string().trim().min(1).max(500);
const createAssetMapSchema = z.object({ primaryAssetRef: ref, primaryAssetSource: z.string().max(60).nullish() });
const usageSchema = z.object({ processRef: ref });
const secondarySchema = z.object({
  secondaryAssetRef: ref,
  secondaryAssetSource: z.string().max(60).optional(),
  groupId: z.string().max(200).nullish(),
  subgroupId: z.string().max(200).nullish(),
});
const threatSchema = z.object({ threatId: ref, isBaseline: z.boolean().optional() });
const vulnSchema = z.object({ vulnId: ref, isBaseline: z.boolean().optional() });
const threatArgs = (body: unknown): [string, boolean] => { const b = threatSchema.parse(body ?? {}); return [b.threatId, b.isBaseline ?? false]; };
const vulnArgs = (body: unknown): [string, boolean] => { const b = vulnSchema.parse(body ?? {}); return [b.vulnId, b.isBaseline ?? false]; };

export const createAssetMap = wrap(async (req, res) => ok(res, await service.createAssetMap(guard(req), createAssetMapSchema.parse(req.body ?? {}), req.ip || null), 201));
export const deleteAssetMap = wrap(async (req, res) => {
  await service.deleteAssetMap(guard(req), req.params.id as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addUsage = wrap(async (req, res) => ok(res, await service.addUsage(guard(req), req.params.id as string, usageSchema.parse(req.body ?? {}).processRef, req.ip || null), 201));
export const deleteUsage = wrap(async (req, res) => {
  await service.deleteUsage(guard(req), req.params.usageId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addSecondary = wrap(async (req, res) => ok(res, await service.addSecondary(guard(req), req.params.usageId as string, secondarySchema.parse(req.body ?? {}), req.ip || null), 201));
export const deleteSecondary = wrap(async (req, res) => {
  await service.deleteSecondary(guard(req), req.params.secondaryId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addThreat = wrap(async (req, res) => ok(res, await service.addThreat(guard(req), req.params.secondaryId as string, ...threatArgs(req.body), req.ip || null), 201));
export const deleteThreat = wrap(async (req, res) => {
  await service.deleteThreat(guard(req), req.params.threatRowId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addVuln = wrap(async (req, res) => ok(res, await service.addVuln(guard(req), req.params.threatRowId as string, ...vulnArgs(req.body), req.ip || null), 201));
export const deleteVuln = wrap(async (req, res) => {
  await service.deleteVuln(guard(req), req.params.vulnRowId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const getBaselineDiff = wrap(async (req, res) => ok(res, await service.getBaselineDiff(guard(req), req.params.secondaryId as string)));
export const refreshBaseline = wrap(async (req, res) => ok(res, await service.refreshBaseline(guard(req), req.params.secondaryId as string, req.ip || null)));
