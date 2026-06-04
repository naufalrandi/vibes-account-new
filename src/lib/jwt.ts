import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
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
  // A random jti guarantees every issued refresh token is unique, so two tokens
  // minted in the same second never collide on their stored hash (important for
  // rotation + reuse detection).
  return jwt.sign({ sub: userId, jti: randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; iat: number; exp: number };
}
