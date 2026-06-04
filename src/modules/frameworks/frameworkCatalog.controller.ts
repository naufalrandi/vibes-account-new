import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./frameworkCatalog.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

// The framework id is taken from the route param so the org is never sourced
// from the request body — the actor's org always comes from the auth context.
const frameworkIdSchema = z.string().uuid();

export async function catalog(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getCatalog(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const frameworkId = frameworkIdSchema.parse(req.params.frameworkId);
    sendOk(res, await service.subscribe(req.auth, frameworkId, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}
