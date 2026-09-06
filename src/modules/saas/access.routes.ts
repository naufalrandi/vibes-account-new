import { Router, type Request, type Response, type NextFunction } from "express";
import { Organization } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import { getTenantAccess } from "./lifecycle.service";

/**
 * The caller's own SaaS access level (R468).
 *
 * `tenantScope` already refuses every request from a locked tenant, which is
 * exactly why this route is mounted with `authenticate` alone: the frontend
 * needs to read "you are locked out" in order to render OD's lockout card, and
 * a route behind the lockout can never answer that question. It exposes
 * nothing a locked tenant could not already infer from the 423 it gets on any
 * other call — only its own tenant's lifecycle state, never another tenant's.
 *
 * Non-tenant callers (ServiceOwner/Distributor staff) always read `full`;
 * OD applies the grace treatment to tenant-portal views only.
 */
export const saasAccessRoutes = Router();

saasAccessRoutes.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) throw new UnauthorizedError();
    if (req.auth.orgType !== "Tenant" || !req.auth.tenantId) {
      sendOk(res, { access: "full", wsState: "Active", subState: { state: "Active" }, tenantName: null });
      return;
    }
    const { access, wsState, subState } = await getTenantAccess(req.auth.tenantId);
    const org = await Organization.findByPk(req.auth.tenantId);
    sendOk(res, { access, wsState, subState, tenantName: org?.name ?? null });
  } catch (e) {
    next(e);
  }
});
