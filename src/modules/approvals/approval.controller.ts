import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./approval.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
function guard(req: Request): AuthContext { if (!req.auth) throw new UnauthorizedError(); return req.auth; }
const ip = (req: Request) => req.ip ?? null;
const listMeta = (d: unknown[]) => ({ page: 1, limit: d.length, total: d.length });
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Schemes
export const listSchemes = wrap(async (req, res) => { const d = await service.listSchemes(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const createScheme = wrap(async (req, res) => sendOk(res, await service.createScheme(guard(req), body.parse(req.body), ip(req)), 201));
export const updateScheme = wrap(async (req, res) => sendOk(res, await service.updateScheme(guard(req), req.params.code as string, body.parse(req.body), ip(req))));
export const deleteScheme = wrap(async (req, res) => { await service.deleteScheme(guard(req), req.params.code as string, ip(req)); sendOk(res, { id: req.params.code }); });

// Module map
export const getModuleMap = wrap(async (req, res) => sendOk(res, await service.getModuleMap(guard(req))));
export const setModuleScheme = wrap(async (req, res) => { const b = z.object({ moduleKey: z.string().min(1), schemeId: z.string().min(1) }).parse(req.body); sendOk(res, await service.setModuleScheme(guard(req), b.moduleKey, b.schemeId, ip(req))); });

// Pools
export const listPoolMembers = wrap(async (req, res) => { const d = await service.listPoolMembers(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const setPoolMember = wrap(async (req, res) => sendOk(res, await service.setPoolMember(guard(req), req.params.userId as string, body.parse(req.body), ip(req))));

// Settings
export const getSettings = wrap(async (req, res) => sendOk(res, await service.getSettings(guard(req))));
export const setSettings = wrap(async (req, res) => { const b = z.object({ selfApprovalAllowed: z.boolean() }).parse(req.body); sendOk(res, await service.setSelfApproval(guard(req), b.selfApprovalAllowed, ip(req))); });

// Governed record workflow
const rec = (req: Request) => ({ module: req.params.module as string, recordId: req.params.recordId as string });
export const getRecord = wrap(async (req, res) => sendOk(res, await service.getApproval(guard(req), rec(req).module, rec(req).recordId)));
export const submit = wrap(async (req, res) => sendOk(res, await service.submit(guard(req), rec(req).module, rec(req).recordId, ip(req))));
export const approve = wrap(async (req, res) => sendOk(res, await service.approve(guard(req), rec(req).module, rec(req).recordId, ip(req))));
export const requestRevision = wrap(async (req, res) => sendOk(res, await service.requestRevision(guard(req), rec(req).module, rec(req).recordId, ip(req))));
export const withdraw = wrap(async (req, res) => sendOk(res, await service.withdraw(guard(req), rec(req).module, rec(req).recordId, ip(req))));
