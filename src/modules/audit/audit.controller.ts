import type { Request, Response, NextFunction } from "express";
import { type WhereOptions } from "sequelize";
import { AuditLog, LoginHistory } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedError();
    const where: WhereOptions = {};
    // SO sees all; others are restricted to their tenant/org.
    if (auth.orgType === "Tenant") Object.assign(where, { tenantId: auth.tenantId });
    else if (auth.orgType === "Distributor") Object.assign(where, { organizationId: auth.orgId });
    const logs = await AuditLog.findAll({ where, order: [["at", "DESC"]], limit: 200 });
    sendOk(res, logs, 200, { page: 1, limit: logs.length, total: logs.length });
  } catch (e) {
    next(e);
  }
}

export async function loginHistory(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await LoginHistory.findAll({ where: { userId: req.params.id }, order: [["at", "DESC"]], limit: 100 });
    sendOk(res, rows);
  } catch (e) {
    next(e);
  }
}
