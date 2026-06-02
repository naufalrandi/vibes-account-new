import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessClaims {
  sub: string; // user id
  orgId: string;
  tenantId: string | null;
  orgType: "ServiceOwner" | "Distributor" | "Tenant";
  roles: string[];
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims & { iat: number; exp: number };
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; iat: number; exp: number };
}
