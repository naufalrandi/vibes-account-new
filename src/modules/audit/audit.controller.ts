import type { Request, Response, NextFunction } from "express";
import { Op, type WhereOptions } from "sequelize";
import { AuditLog, LoginHistory, Organization, User } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { NotFoundError, UnauthorizedError } from "../../lib/errors";
import { userScopeWhere } from "../../lib/scope";
import { offsetPageMeta, parseOffsetPage } from "../../lib/pagination";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedError();
    const where: WhereOptions = {};
    // Optional org filter for drill-down (e.g. a tenant's Audit Log tab). It is
    // applied WITHIN the caller's scope — a non-SO caller can never use it to
    // widen visibility beyond what their role already allows.
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    if (auth.orgType === "Tenant") {
      // Tenants only ever see their own tenant's logs; ignore any orgId filter.
      // A row belongs to the tenant when it is tagged with it or is about the
      // tenant org itself (older rows and org-scoped writes carry only
      // organizationId).
      const tenant = auth.tenantId ?? auth.orgId;
      Object.assign(where, { [Op.or]: [{ tenantId: tenant }, { organizationId: tenant }] });
    } else if (auth.orgType === "Distributor") {
      // Default to the distributor's own org. A drill-down orgId is honoured only
      // when it is a tenant this distributor parents; otherwise it is ignored.
      let scopedOrgId = auth.orgId;
      if (orgId && orgId !== auth.orgId) {
        const child = await Organization.findOne({ where: { id: orgId, parentOrgId: auth.orgId } });
        if (child) scopedOrgId = orgId;
      }
      Object.assign(where, { organizationId: scopedOrgId });
    } else if (orgId) {
      // Service Owner: honour the filter as given (sees all otherwise).
      Object.assign(where, { organizationId: orgId });
    }
    const page = parseOffsetPage(req.query);
    const { rows, count } = await AuditLog.findAndCountAll({ where, order: [["at", "DESC"]], limit: page.limit, offset: page.offset });
    sendOk(res, rows, 200, offsetPageMeta(count, page));
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
