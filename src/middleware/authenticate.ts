import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { getEffectiveAccess } from "../modules/iam/access.service";
import { UnauthorizedError } from "../lib/errors";

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedError();
    const claims = verifyAccessToken(header.slice(7));
    // Resolve effective access per-request (revocation-friendly), not from the token.
    const access = await getEffectiveAccess(claims.sub);
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
    next(err instanceof Error && err.name === "AppError" ? err : new UnauthorizedError("Invalid or expired token"));
  }
}
