import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque single-use tokens (password reset, account activation). Only the
 * SHA-256 hash is persisted; the raw value goes to the user by email and is
 * looked up with `hashToken(raw)`, so a database leak yields no usable tokens.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}
