import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken, type AccessClaims } from "../lib/jwt";
import { getEffectiveAccess } from "../modules/iam/access.service";
import { UnauthorizedError } from "../lib/errors";

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedError();
    let claims: AccessClaims;
    try {
      claims = verifyAccessToken(header.slice(7));
    } catch (err) {
      // Only a bad token is the caller's fault. TokenExpiredError and
      // NotBeforeError both extend JsonWebTokenError; anything else is ours.
      if (err instanceof jwt.JsonWebTokenError) throw new UnauthorizedError("Invalid or expired token");
      throw err;
    }
    // Resolve effective access per-request (revocation-friendly), not from the token.
    // Errors from here on (e.g. a DB outage) propagate as 500, never as a 401.
    const access = await getEffectiveAccess(claims.sub);
    // A suspended/deleted user or a suspended/inactive org loses access at
    // once, not when the access token expires.
    if (!access.active) throw new UnauthorizedError("Account is not active", "ACCOUNT_INACTIVE");
    req.auth = {
      userId: claims.sub,
      orgId: claims.orgId,
      tenantId: claims.tenantId,
      orgType: claims.orgType,
      isSuperAdmin: access.isSuperAdmin,
      actions: access.actionKeys,
    };
    next();
  } catch (err) {
    next(err);
  }
}
