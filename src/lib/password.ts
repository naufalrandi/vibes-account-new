import bcrypt from "bcryptjs";
import { env } from "../config/env";

const ROUNDS = 12;
// bcrypt only reads the first 72 bytes; anything longer would be silently
// truncated, so two passwords sharing a 72-byte prefix would both verify.
const MAX_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const PASSWORD_POLICY_MESSAGE =
  `Password must be at least ${env.PASSWORD_MIN_LENGTH} characters (at most ${MAX_BYTES} bytes) ` +
  "and include an uppercase letter, a lowercase letter, and a digit.";

/** PRD password policy: >= PASSWORD_MIN_LENGTH chars, <= 72 bytes, 1 upper, 1 lower, 1 digit. */
export function isPasswordValid(plain: string): boolean {
  return (
    plain.length >= env.PASSWORD_MIN_LENGTH &&
    Buffer.byteLength(plain, "utf8") <= MAX_BYTES &&
    /[a-z]/.test(plain) &&
    /[A-Z]/.test(plain) &&
    /\d/.test(plain)
  );
}
