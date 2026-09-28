import { Op } from "sequelize";
import { env } from "../../config/env";
import { Notification } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { sendMail } from "../../lib/mailer";
import { newOpaqueToken } from "../../lib/tokens";
import {
  ACTIVATION_TTL_DAYS, activationEmail, passwordResetEmail, poConfirmationEmail, type ActivationVariant,
} from "./email.templates";

/**
 * Mints an activation token. Persist `fields` on the User (only the hash is
 * stored) and email `raw` via `sendActivationInvite` — never log or return it.
 */
export function issueActivationToken(): { raw: string; fields: { activationToken: string; activationTokenExpiresAt: Date } } {
  const { raw, hash } = newOpaqueToken();
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, fields: { activationToken: hash, activationTokenExpiresAt: expiresAt } };
}

/** Emails the activation link. Resolves false (never throws) when the send fails. */
export function sendActivationInvite(
  email: string,
  raw: string,
  opts: { variant?: ActivationVariant; resend?: boolean } = {},
): Promise<boolean> {
  return sendMail({ to: email, ...activationEmail(`${env.APP_BASE_URL}/activate?token=${encodeURIComponent(raw)}`, opts) });
}

/** Emails the password-reset link. Resolves false (never throws) when the send fails. */
export function sendPasswordReset(email: string, raw: string): Promise<boolean> {
  return sendMail({ to: email, ...passwordResetEmail(`${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(raw)}`) });
}

/** Emails a supplier the public PO confirmation link (`/po-confirm/<code>?t=<token>`). Never throws. */
export function sendPoConfirmation(
  email: string,
  po: { code: string; token: string; supplierName?: string; title?: string },
): Promise<boolean> {
  const link = `${env.APP_BASE_URL}/po-confirm/${encodeURIComponent(po.code)}?t=${encodeURIComponent(po.token)}`;
  return sendMail({ to: email, ...poConfirmationEmail(link, po) });
}

export interface NotificationView {
  id: string;
  text: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function view(n: Notification): NotificationView {
  return { id: n.id, text: n.text, link: n.link, read: n.read, createdAt: n.createdAt.toISOString() };
}

/** Notifications targeted at this user, or org-wide (user_id NULL) for their org. */
function actorWhere(auth: AuthContext) {
  return { [Op.or]: [{ userId: auth.userId }, { orgId: auth.orgId, userId: null }] };
}

export async function listForActor(auth: AuthContext): Promise<NotificationView[]> {
  const rows = await Notification.findAll({ where: actorWhere(auth), order: [["createdAt", "DESC"]], limit: 100 });
  return rows.map(view);
}

/** Mark the actor's unread notifications read — all of them, or only `ids` (others' ids are silently ignored). */
export async function markRead(auth: AuthContext, ids?: string[]): Promise<number> {
  const where = { ...actorWhere(auth), read: false, ...(ids ? { id: { [Op.in]: ids } } : {}) };
  const [updated] = await Notification.update({ read: true }, { where });
  return updated;
}

/** Create a bell notification (org-wide when `userId` is omitted). */
export async function createNotification(input: { orgId?: string | null; userId?: string | null; type?: string; text: string; link?: string | null }): Promise<void> {
  await Notification.create({
    orgId: input.orgId ?? null,
    userId: input.userId ?? null,
    type: input.type ?? "info",
    text: input.text,
    link: input.link ?? null,
  });
}
