import type { Request, Response, NextFunction } from "express";
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
export const createAssetMap = wrap(async (req, res) => ok(res, await service.createAssetMap(guard(req), req.body, req.ip || null), 201));
export const deleteAssetMap = wrap(async (req, res) => {
  await service.deleteAssetMap(guard(req), req.params.id as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addUsage = wrap(async (req, res) => ok(res, await service.addUsage(guard(req), req.params.id as string, req.body.processRef, req.ip || null), 201));
export const deleteUsage = wrap(async (req, res) => {
  await service.deleteUsage(guard(req), req.params.usageId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addSecondary = wrap(async (req, res) => ok(res, await service.addSecondary(guard(req), req.params.usageId as string, req.body, req.ip || null), 201));
export const deleteSecondary = wrap(async (req, res) => {
  await service.deleteSecondary(guard(req), req.params.secondaryId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addThreat = wrap(async (req, res) => ok(res, await service.addThreat(guard(req), req.params.secondaryId as string, req.body.threatId, req.body.isBaseline, req.ip || null), 201));
export const deleteThreat = wrap(async (req, res) => {
  await service.deleteThreat(guard(req), req.params.threatRowId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const addVuln = wrap(async (req, res) => ok(res, await service.addVuln(guard(req), req.params.threatRowId as string, req.body.vulnId, req.body.isBaseline, req.ip || null), 201));
export const deleteVuln = wrap(async (req, res) => {
  await service.deleteVuln(guard(req), req.params.vulnRowId as string, req.ip || null);
  ok(res, { deleted: true });
});
export const getBaselineDiff = wrap(async (req, res) => ok(res, await service.getBaselineDiff(guard(req), req.params.secondaryId as string)));
export const refreshBaseline = wrap(async (req, res) => ok(res, await service.refreshBaseline(guard(req), req.params.secondaryId as string, req.ip || null)));
