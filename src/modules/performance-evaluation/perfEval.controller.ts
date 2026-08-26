import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./perfEval.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const orgOf = (req: Request) => (typeof req.query.orgId === "string" ? req.query.orgId : undefined);
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

export const list = wrap(async (req, res) => ok(res, await service.listPerfEvals(guard(req), orgOf(req))));
export const indicators = wrap(async (req, res) => ok(res, await service.getPerfIndicators(guard(req), orgOf(req))));
export const get = wrap(async (req, res) => ok(res, await service.getPerfEval(guard(req), req.params.id as string)));
export const create = wrap(async (req, res) => ok(res, await service.createPerfEval(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const update = wrap(async (req, res) => ok(res, await service.updatePerfEval(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
