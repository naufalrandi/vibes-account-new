import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
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

// Body schemas mirror israSoa.service.ts's reads; unknown keys (incl. orgId) are stripped.
const customControlSchema = z.object({
  name: z.string().max(500).nullish(),
  description: z.string().max(10_000).nullish(),
  category: z.string().max(200).nullish(),
  type: z.string().max(100).nullish(),
  csf: z.string().max(100).nullish(),
});
const justificationSchema = z.object({ justification: z.string().max(10_000) });

export const getSoa = wrap(async (req, res) => ok(res, await service.getSoa(guard(req))));
export const createCustomControl = wrap(async (req, res) =>
  ok(res, await service.createCustomControl(guard(req), customControlSchema.parse(req.body ?? {}), req.ip || null), 201)
);
export const saveSoaJustification = wrap(async (req, res) =>
  ok(res, await service.saveSoaJustification(guard(req), req.params.annexRef as string, justificationSchema.parse(req.body ?? {}).justification, req.ip || null))
);
