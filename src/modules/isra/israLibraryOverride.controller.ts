import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./israLibraryOverride.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const fieldsSchema = z.record(z.string(), z.unknown());
const sourceKeySchema = z.object({ sourceKey: z.string().min(1).max(200) });
const itemKeySchema = z.object({ itemKey: z.string().min(1).max(200) });

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const orgOf = (req: Request) => (typeof req.query.orgId === "string" ? req.query.orgId : undefined);
const libTypeOf = (req: Request) => (typeof req.query.libType === "string" ? req.query.libType : undefined);
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

export const listEffective = wrap(async (req, res) =>
  ok(res, await service.listEffectiveLibrary(guard(req), req.params.libType as string, orgOf(req))));

export const listOverrides = wrap(async (req, res) =>
  ok(res, await service.listLibraryOverrides(guard(req), req.params.libType as string, orgOf(req))));
export const saveOverride = wrap(async (req, res) =>
  ok(res, await service.saveLibraryOverride(guard(req), req.params.libType as string, req.params.platformItemId as string, fieldsSchema.parse(req.body), orgOf(req), ip(req))));
export const restoreOverride = wrap(async (req, res) =>
  ok(res, await service.restoreLibraryOverride(guard(req), req.params.libType as string, req.params.platformItemId as string, orgOf(req), ip(req))));

export const createItem = wrap(async (req, res) =>
  ok(res, await service.createLibraryItem(guard(req), req.params.libType as string, fieldsSchema.parse(req.body), orgOf(req), ip(req)), 201));
export const copyItem = wrap(async (req, res) =>
  ok(res, await service.copyLibraryItem(guard(req), req.params.libType as string, sourceKeySchema.parse(req.body).sourceKey, orgOf(req), ip(req)), 201));
export const updateItem = wrap(async (req, res) =>
  ok(res, await service.updateLibraryItem(guard(req), req.params.libType as string, req.params.tenantItemId as string, fieldsSchema.parse(req.body), orgOf(req), ip(req))));

export const listArchived = wrap(async (req, res) =>
  ok(res, await service.listArchivedItems(guard(req), req.params.libType as string, orgOf(req))));
export const archiveItem = wrap(async (req, res) =>
  ok(res, await service.archiveLibraryItem(guard(req), req.params.libType as string, itemKeySchema.parse(req.body).itemKey, orgOf(req), ip(req)), 201));
export const unarchiveItem = wrap(async (req, res) =>
  ok(res, await service.unarchiveLibraryItem(guard(req), req.params.libType as string, itemKeySchema.parse(req.body).itemKey, orgOf(req), ip(req))));

export const listAudit = wrap(async (req, res) =>
  ok(res, await service.listLibraryAudit(guard(req), orgOf(req), libTypeOf(req))));
