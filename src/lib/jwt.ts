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

// The algorithm is pinned on both sign and verify so a crafted token cannot
// negotiate a weaker/`none` algorithm (algorithm-confusion defense). Issuer +
// audience are set and validated so an access token can't be replayed at the
// refresh boundary (or across services sharing a secret).
const ALG = "HS256" as const;
const ISSUER = "vibes-account";
const AUD_ACCESS = "vibes-access";
const AUD_REFRESH = "vibes-refresh";

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL, algorithm: ALG, issuer: ISSUER, audience: AUD_ACCESS });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALG], issuer: ISSUER, audience: AUD_ACCESS }) as AccessClaims & { iat: number; exp: number };
}

export function signRefreshToken(userId: string): string {
  // A random jti guarantees every issued refresh token is unique, so two tokens
  // minted in the same second never collide on their stored hash (important for
  // rotation + reuse detection).
  return jwt.sign({ sub: userId, jti: randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    algorithm: ALG,
    issuer: ISSUER,
    audience: AUD_REFRESH,
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [ALG], issuer: ISSUER, audience: AUD_REFRESH }) as { sub: string; iat: number; exp: number };
}
