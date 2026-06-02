import { env } from "../../config/env";

/** Stub transport: logs the link. Replace with a real SMTP/provider later. */
export function sendActivationInvite(email: string, activationToken: string): void {
  const link = `${env.APP_BASE_URL}/activate?token=${activationToken}`;
  // eslint-disable-next-line no-console
  console.log(`[notification] activation invite -> ${email}: ${link}`);
}

export function sendPasswordReset(email: string, resetToken: string): void {
  const link = `${env.APP_BASE_URL}/reset-password?token=${resetToken}`;
  // eslint-disable-next-line no-console
  console.log(`[notification] password reset -> ${email}: ${link}`);
}
