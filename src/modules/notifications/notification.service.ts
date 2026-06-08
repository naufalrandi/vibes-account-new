import { Op, type WhereOptions } from "sequelize";
import { env } from "../../config/env";
import { Notification } from "../../db/models";
import type { AuthContext } from "../../lib/scope";

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

// === In-app bell notifications ===============================================

export interface NotificationView {
  id: string;
  text: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function toView(n: Notification): NotificationView {
  return { id: n.id, text: n.text, link: n.link, read: n.read, createdAt: n.createdAt.toISOString() };
}

/**
 * Notifications visible to the caller: SO sees all; others see their own org's +
 * platform-wide (orgId IS NULL). Op.in cannot match NULL, so the null arm uses an
 * explicit `{ orgId: null }` which Sequelize renders as `org_id IS NULL`.
 */
function visibilityWhere(auth: AuthContext): WhereOptions {
  if (auth.orgType === "ServiceOwner") return {};
  return { [Op.or]: [{ orgId: auth.orgId }, { orgId: null }] } as WhereOptions;
}

export async function listNotifications(auth: AuthContext): Promise<NotificationView[]> {
  const rows = await Notification.findAll({ where: visibilityWhere(auth), order: [["createdAt", "DESC"]], limit: 50 });
  return rows.map(toView);
}

/** Mark every notification visible to the caller as read (bell-open behavior). */
export async function markAllRead(auth: AuthContext): Promise<{ updated: number }> {
  const [updated] = await Notification.update({ read: true }, { where: { ...visibilityWhere(auth), read: false } });
  return { updated };
}

/** Append a notification for an org (or platform-wide when orgId is null). Used by other modules. */
export async function pushNotification(orgId: string | null, text: string, link: string | null = null): Promise<void> {
  await Notification.create({ orgId, text, link, read: false });
}
