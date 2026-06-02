import type { Request, Response, NextFunction } from "express";
import { type WhereOptions } from "sequelize";
import { AuditLog, LoginHistory, Organization, User } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { NotFoundError, UnauthorizedError } from "../../lib/errors";
import { userScopeWhere } from "../../lib/scope";

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
    const auth = req.auth;
    if (!auth) throw new UnauthorizedError();
    const targetUserId = req.params.id as string;
    // Login history is sensitive (source IPs + timestamps). Only expose it for a
    // target user that falls within the actor's visible user set; otherwise 404
    // so existence is not leaked across tenant boundaries.
    const where: WhereOptions = { id: targetUserId, ...userScopeWhere(auth) };
    const visible = await User.findOne({ where, include: [{ model: Organization, required: false }] });
    if (!visible) throw new NotFoundError("User not found");
    const rows = await LoginHistory.findAll({ where: { userId: targetUserId }, order: [["at", "DESC"]], limit: 100 });
    sendOk(res, rows);
  } catch (e) {
    next(e);
  }
}
