import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./myFramework.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

// The subscription id is taken from the route param; the organization is always
// resolved from the auth context, never from the request body or query.
const subscriptionIdSchema = z.string().uuid();

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listMyFrameworks(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const subscriptionId = subscriptionIdSchema.parse(req.params.subscriptionId);
    sendOk(res, await service.removeMyFramework(req.auth, subscriptionId, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
