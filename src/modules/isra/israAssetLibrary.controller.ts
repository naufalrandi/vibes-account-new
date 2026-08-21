import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israAssetLibrary.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Primary Asset Library
export const listPrimaryAssets = wrap(async (req, res) => { guard(req); ok(res, await service.listPrimaryAssets()); });
export const createPrimaryAsset = wrap(async (req, res) => ok(res, await service.createPrimaryAsset(guard(req), body.parse(req.body), ip(req)), 201));
export const updatePrimaryAsset = wrap(async (req, res) => ok(res, await service.updatePrimaryAsset(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deletePrimaryAsset = wrap(async (req, res) => { await service.deletePrimaryAsset(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });

// Secondary Asset Library
export const listSecondaryAssets = wrap(async (req, res) => { guard(req); ok(res, await service.listSecondaryAssets()); });
export const createSecondaryAsset = wrap(async (req, res) => ok(res, await service.createSecondaryAsset(guard(req), body.parse(req.body), ip(req)), 201));
export const updateSecondaryAsset = wrap(async (req, res) => ok(res, await service.updateSecondaryAsset(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteSecondaryAsset = wrap(async (req, res) => { await service.deleteSecondaryAsset(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });
