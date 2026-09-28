import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Mail captured instead of sent while NODE_ENV=test — integration tests read
 * activation/reset links from here (`test/helpers.ts` `lastMailedToken`). Test
 * runs always capture, even when a developer's .env sets SMTP_HOST, so the
 * suite never emails anyone.
 */
export const testOutbox: MailMessage[] = [];

let transport: Transporter | undefined;

function smtp(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

/**
 * Sends one email. Never throws: resolves false on failure so callers decide
 * whether a lost email matters. Logs name only the recipient and subject —
 * bodies carry bearer links (activation, password reset, PO confirmation).
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  try {
    if (env.NODE_ENV === "test") {
      testOutbox.push(msg);
      return true;
    }
    if (!env.SMTP_HOST) {
      // Production refuses to boot without SMTP_HOST (config/env.ts), so this
      // is the local-development fallback: print the mail so links are usable.
      if (env.NODE_ENV === "production") {
        console.error(`[mailer] SMTP_HOST not configured; "${msg.subject}" to ${msg.to} not sent`);
        return false;
      }
      console.log(`[mailer] (no SMTP_HOST) to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      return true;
    }
    await smtp().sendMail({ from: env.MAIL_FROM, ...msg });
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "unknown";
    console.error(`[mailer] failed to send "${msg.subject}" to ${msg.to} (${code})`);
    return false;
  }
}
