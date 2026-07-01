import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as ds from "./scopeDataset.service";
import * as scope from "./scope.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
function guard(req: Request): AuthContext { if (!req.auth) throw new UnauthorizedError(); return req.auth; }
const ip = (req: Request) => req.ip ?? null;
const listMeta = (d: unknown[]) => ({ page: 1, limit: d.length, total: d.length });
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Scope datasets (SP master pick-lists)
export const listDatasets = wrap(async (req, res) => { const d = await ds.listDatasets(guard(req), typeof req.query.kind === "string" ? req.query.kind : undefined); sendOk(res, d, 200, listMeta(d)); });
export const createDataset = wrap(async (req, res) => sendOk(res, await ds.createDataset(guard(req), body.parse(req.body), ip(req)), 201));
export const updateDataset = wrap(async (req, res) => sendOk(res, await ds.updateDataset(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteDataset = wrap(async (req, res) => { await ds.deleteDataset(guard(req), req.params.id as string, ip(req)); sendOk(res, { id: req.params.id }); });

// Management System Scope (6-dimension document)
const orgOf = (req: Request) => (typeof req.query.orgId === "string" ? req.query.orgId : undefined);
export const listScopes = wrap(async (req, res) => { const d = await scope.listScopes(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const getScope = wrap(async (req, res) => sendOk(res, await scope.getScope(guard(req), req.params.id as string)));
export const createScope = wrap(async (req, res) => sendOk(res, await scope.createScope(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const updateScope = wrap(async (req, res) => sendOk(res, await scope.updateScope(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const approveScope = wrap(async (req, res) => sendOk(res, await scope.approveScope(guard(req), req.params.id as string, ip(req))));
export const activateScope = wrap(async (req, res) => sendOk(res, await scope.activateScope(guard(req), req.params.id as string, ip(req))));
export const archiveScope = wrap(async (req, res) => sendOk(res, await scope.archiveScope(guard(req), req.params.id as string, ip(req))));
export const scopeDiff = wrap(async (req, res) => sendOk(res, await scope.scopeDiff(guard(req), req.params.id as string)));
export const submitChanges = wrap(async (req, res) => sendOk(res, await scope.submitChanges(guard(req), req.params.id as string, ip(req))));
export const partnerApprove = wrap(async (req, res) => sendOk(res, await scope.partnerApprove(guard(req), req.params.id as string, ip(req))));
export const spApprove = wrap(async (req, res) => sendOk(res, await scope.spApprove(guard(req), req.params.id as string, ip(req))));
export const rejectChange = wrap(async (req, res) => sendOk(res, await scope.rejectChange(guard(req), req.params.id as string, ip(req))));
