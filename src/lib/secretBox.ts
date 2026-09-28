import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

/**
 * AES-256-GCM sealing for secrets stored at rest (the AI provider API key).
 * Each seal uses a fresh 96-bit IV; the auth tag makes any tampering with the
 * ciphertext, IV or tag — or opening with the wrong key — throw instead of
 * returning garbage.
 */
export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

/** The configured AI_ENCRYPTION_KEY as a 32-byte key, or null when unset. */
export function aiEncryptionKey(): Buffer | null {
  return env.AI_ENCRYPTION_KEY ? Buffer.from(env.AI_ENCRYPTION_KEY, "base64") : null;
}

export function seal(plaintext: string, key: Buffer): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

/** Throws when the key is wrong or any part of the sealed value was altered. */
export function open(sealed: SealedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
