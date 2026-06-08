import type { Request, Response, NextFunction } from "express";
import * as service from "./xref.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getCrossReference(req.auth));
  } catch (e) {
    next(e);
  }
}
