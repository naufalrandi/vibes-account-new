import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Organization, User } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { userScopeWhere } from "../../lib/scope";
import { UnauthorizedError } from "../../lib/errors";

/**
 * OD `tmProvisioned` (js/core.js:4913) — staff who are on the roster but hold
 * no platform access, which Team Management counts on its "No access" stat
 * card.
 *
 * The frontend has called `GET /hr-employees` since the card was written, and
 * nothing implemented it: the request 404'd, the response was discarded as a
 * failure, and the card read a confident 0 forever. It was invisible because
 * the endpoint-reachability guard's path matcher dropped any path whose last
 * literal segment is immediately followed by a template interpolation — see
 * `__endpointReachability.test.ts`.
 *
 * There is no separate HR table: an unprovisioned person is a `User` row with
 * `provisioned = false` (`user.service.ts` sets it from whether a role was
 * granted, matching OD's seed semantics), so this reads the same rows the team
 * list reads and reshapes them.
 */
const querySchema = z.object({ orgId: z.string().uuid().optional() });

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = querySchema.parse(req.query);
    if (!req.auth) throw new UnauthorizedError();
    // Scoped the same way the team list is: `orgId` narrows within the caller's
    // visibility, it does not grant it. Without this a Distributor admin could
    // list every unprovisioned person on the platform.
    const rows = await User.findAll({
      where: { ...userScopeWhere(req.auth), provisioned: false, ...(orgId ? { orgId } : {}) },
      // The Distributor scope clause resolves `$Organization.parent_org_id$`, so
      // the association has to be joined or the query is invalid SQL.
      include: [{ model: Organization, attributes: [], required: true }],
      order: [["fullName", "ASC"]],
    });
    sendOk(
      res,
      rows.map((u) => ({
        id: u.id,
        orgId: u.orgId,
        fullName: u.fullName,
        email: u.email,
        role: u.position ?? undefined,
        workUnit: u.workUnit ?? undefined,
        siteId: u.siteId ?? null,
        provisioned: false,
        // The person already has a User row; `userId` points at it so the
        // frontend can link the directory entry to the account it becomes.
        userId: u.id,
      })),
    );
  } catch (err) {
    next(err);
  }
}
