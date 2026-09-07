import { Router, type Request, type Response, type NextFunction } from "express";
import { Organization } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import { organizationScopeWhere } from "../../lib/scope";
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
    // Read through the actor's own organization scope rather than by raw
    // primary key: for the Tenant caller this branch is reached by,
    // `organizationScopeWhere` is `{ id: auth.orgId }`, and a tenant org's
    // `tenantId` is its own id (saas.service.ts `org.tenantId = org.id`), so
    // this is the same row — but a token whose tenant claim named another
    // tenant now reads nothing instead of that tenant's name.
    const org = await Organization.findOne({ where: organizationScopeWhere(req.auth) });
    sendOk(res, { access, wsState, subState, tenantName: org?.name ?? null });
  } catch (e) {
    next(e);
  }
});
