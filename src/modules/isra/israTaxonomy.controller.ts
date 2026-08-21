import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israTaxonomy.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
const statusSchema = z.object({ status: z.string().min(1).max(40) });

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const groupOf = (req: Request) => (typeof req.query.groupId === "string" ? req.query.groupId : undefined);
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// PA Groups
export const listPaGroups = wrap(async (req, res) => { guard(req); ok(res, await service.listPaGroups()); });
export const createPaGroup = wrap(async (req, res) => ok(res, await service.createPaGroup(guard(req), body.parse(req.body), ip(req)), 201));
export const updatePaGroup = wrap(async (req, res) => ok(res, await service.updatePaGroup(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deletePaGroup = wrap(async (req, res) => { await service.deletePaGroup(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });

// PA Subgroups
export const listPaSubgroups = wrap(async (req, res) => { guard(req); ok(res, await service.listPaSubgroups(groupOf(req))); });
export const createPaSubgroup = wrap(async (req, res) => ok(res, await service.createPaSubgroup(guard(req), body.parse(req.body), ip(req)), 201));
export const updatePaSubgroup = wrap(async (req, res) => ok(res, await service.updatePaSubgroup(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deletePaSubgroup = wrap(async (req, res) => { await service.deletePaSubgroup(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });

// SA Groups
export const listSaGroups = wrap(async (req, res) => { guard(req); ok(res, await service.listSaGroups()); });
export const createSaGroup = wrap(async (req, res) => ok(res, await service.createSaGroup(guard(req), body.parse(req.body), ip(req)), 201));
export const updateSaGroup = wrap(async (req, res) => ok(res, await service.updateSaGroup(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteSaGroup = wrap(async (req, res) => { await service.deleteSaGroup(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });

// SA Subgroups
export const listSaSubgroups = wrap(async (req, res) => { guard(req); ok(res, await service.listSaSubgroups(groupOf(req))); });
export const createSaSubgroup = wrap(async (req, res) => ok(res, await service.createSaSubgroup(guard(req), body.parse(req.body), ip(req)), 201));
export const updateSaSubgroup = wrap(async (req, res) => ok(res, await service.updateSaSubgroup(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteSaSubgroup = wrap(async (req, res) => { await service.deleteSaSubgroup(guard(req), req.params.id as string, ip(req)); ok(res, { deleted: true }); });
export const setSaSubgroupStatus = wrap(async (req, res) =>
  ok(res, await service.setSaSubgroupStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
