import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

const POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/** PRD password policy: >=8 chars, 1 upper, 1 lower, 1 digit. */
export function isPasswordValid(plain: string): boolean {
  return POLICY.test(plain);
}
