import type { Request, Response, NextFunction } from "express";
import * as dashboardService from "./dashboard.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import { FEATURE_KEY, countByUrgency, itemsForCaller } from "../ai/deadlines/digest";
import { isFeatureEnabled } from "../ai/features/flags";

export async function stats(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    // `?orgId=` targets a specific tenant (the SaaS preview). The service
    // authorizes it; an absent or own-org value behaves exactly as before.
    const orgId = typeof req.query.orgId === "string" && req.query.orgId ? req.query.orgId : undefined;
    const data = await dashboardService.getDashboardStats(req.auth, orgId);
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

/** No AI here: the widget lists items even when AI is off; the AI summary is the separate digest-preview action. */
export async function deadlines(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    if (!(await isFeatureEnabled(req.auth.orgId, FEATURE_KEY))) {
      sendOk(res, { enabled: false, today: null, items: [], counts: null });
      return;
    }
    const { today, items } = await itemsForCaller(req.auth);
    sendOk(res, { enabled: true, today, items, counts: countByUrgency(items) });
  } catch (e) {
    next(e);
  }
}
