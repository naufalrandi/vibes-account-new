import type { Request, Response, NextFunction } from "express";
import * as dashboardService from "./dashboard.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

export async function stats(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await dashboardService.getDashboardStats(req.auth);
    sendOk(res, data);
  } catch (e) {
    next(e);
  }
}

export async function recent(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const data = await dashboardService.getDashboardRecent(req.auth);
    sendOk(res, data);
  } catch (e) {
    next(e);
  }
}
