import { Op } from "sequelize";
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

export async function markAllRead(auth: AuthContext): Promise<number> {
  const [updated] = await Notification.update({ read: true }, { where: { ...actorWhere(auth), read: false } });
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
