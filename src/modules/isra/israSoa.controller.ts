import type { Request, Response, NextFunction } from "express";
import * as service from "./israSoa.service";
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

export const getSoa = wrap(async (req, res) => ok(res, await service.getSoa(guard(req))));
export const createCustomControl = wrap(async (req, res) =>
  ok(res, await service.createCustomControl(guard(req), req.body, req.ip || null), 201)
);
export const saveSoaJustification = wrap(async (req, res) =>
  ok(res, await service.saveSoaJustification(guard(req), req.params.annexRef as string, req.body.justification, req.ip || null))
);
