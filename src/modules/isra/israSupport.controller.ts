import type { Request, Response, NextFunction } from "express";
import * as service from "./israSupport.service";
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

export const getOrgSettings = wrap(async (req, res) => ok(res, await service.getOrgSettings(guard(req))));
export const saveOrgSettings = wrap(async (req, res) => ok(res, await service.saveOrgSettings(guard(req), req.body, req.ip || null)));
export const getAppetiteLog = wrap(async (req, res) => ok(res, await service.getAppetiteLog(guard(req))));
export const logAppetite = wrap(async (req, res) => ok(res, await service.logAppetite(guard(req), req.body, req.ip || null), 201));
export const validateIntegrity = wrap(async (req, res) => ok(res, await service.validateIntegrity(guard(req))));
