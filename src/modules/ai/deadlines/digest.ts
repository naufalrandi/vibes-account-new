import { Op, QueryTypes } from "sequelize";
import { z } from "zod";
import { env } from "../../../config/env";
import { Notification, Organization, User } from "../../../db/models";
import { sequelize } from "../../../db/sequelize";
import { isAiAvailable } from "../../../lib/ai";
import { DEFAULT_TZ, todayInTz } from "../../../lib/localDate";
import { sendMail } from "../../../lib/mailer";
import type { AuthContext } from "../../../lib/scope";
import { getEffectiveAccess } from "../../iam/access.service";
import { escapeHtml, type EmailContent } from "../../notifications/email.templates";
import { createNotification } from "../../notifications/notification.service";
import { citeList, truncateForPrompt } from "../features/context";
import { isFeatureEnabled } from "../features/flags";
import { runAction } from "../features/runtime";
import type { AiActionContext } from "../features/types";
import { assignItems, scanOrg, type DeadlineItem, type Recipient, type Urgency } from "./scan";

export const FEATURE_KEY = "deadline-agent";
export const DIGEST_HOUR = 7;
/** ponytail: at most this many bell notifications per user per day (most urgent first); the email lists everything. */
const MAX_NOTIFICATIONS = 20;
const MAX_EMAIL_ITEMS = 60;
const MARKER_PREFIX = "deadline-digest:";

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: "Overdue", today: "Due today", week: "Due this week", later: "Coming up",
};
const URGENCY_ORDER: Urgency[] = ["overdue", "today", "week", "later"];

export function countByUrgency(items: DeadlineItem[]): Record<Urgency, number> {
  const out = { overdue: 0, today: 0, week: 0, later: 0 };
  for (const i of items) out[i.urgency] += 1;
  return out;
}

export function dueText(i: DeadlineItem): string {
  if (i.daysLeft < 0) return `overdue by ${-i.daysLeft} day${i.daysLeft === -1 ? "" : "s"}`;
  if (i.daysLeft === 0) return "due today";
  return `due in ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"} (${i.due})`;
}

const itemLine = (i: DeadlineItem) => `${i.sourceLabel}: ${i.code ? `${i.code} ` : ""}${i.title} — ${dueText(i)}`;

/** The no-AI intro: counts, then the first thing to do. */
export function templateIntro(items: DeadlineItem[]): string {
  const c = countByUrgency(items);
  const parts = [
    c.overdue && `${c.overdue} overdue`, c.today && `${c.today} due today`,
    c.week && `${c.week} due this week`, c.later && `${c.later} coming up`,
  ].filter(Boolean);
  const first = items[0];
  return `You have ${items.length} item${items.length === 1 ? "" : "s"} needing attention: ${parts.join(", ")}.` +
    (first ? ` Start with ${first.code ?? first.title} (${first.sourceLabel.toLowerCase()}, ${dueText(first)}).` : "");
}

/** Prompt for the AI intro — items cited by code (or key) so the model can name them. */
export function introPrompt(items: DeadlineItem[], today: string): { system: string; user: string } {
  const sources = items.slice(0, 40).map((i) => ({
    id: i.code ?? i.key,
    text: `${i.sourceLabel} — ${i.title} — ${dueText(i)} (${URGENCY_LABEL[i.urgency]})`,
  }));
  return {
    system:
      "You write the opening paragraph of a person's daily deadline digest in a compliance management system. " +
      "In 2-4 plain sentences: say what to tackle first and why (overdue items, then items with regulatory, customer or certification impact), " +
      "then what is coming up. No greeting, no sign-off, no bullet list, no markdown. Refer to items by their id.",
    user: truncateForPrompt(`Today is ${today}. ${templateIntro(items)}\n\nItems:\n${citeList(sources)}`, 8000),
  };
}

export function digestEmail(name: string, intro: string, items: DeadlineItem[], baseUrl: string): EmailContent {
  const c = countByUrgency(items);
  const subject = c.overdue
    ? `Your deadlines: ${c.overdue} overdue, ${items.length - c.overdue} upcoming`
    : `Your deadlines: ${items.length} upcoming`;
  const shown = items.slice(0, MAX_EMAIL_ITEMS);
  const more = items.length - shown.length;
  const groups = URGENCY_ORDER.map((u) => ({ u, rows: shown.filter((i) => i.urgency === u) })).filter((g) => g.rows.length);
  const url = (i: DeadlineItem) => `${baseUrl}${i.link}`;
  const text = [
    `Hello ${name},`, intro,
    ...groups.map((g) => `${URGENCY_LABEL[g.u]}\n${g.rows.map((i) => `- ${itemLine(i)}\n  ${url(i)}`).join("\n")}`),
    more > 0 ? `…and ${more} more in Vibes.` : "",
    "You receive this digest because these items are assigned to you in Vibes.",
  ].filter(Boolean).join("\n\n");
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;max-width:640px">`,
    `<p style="margin:0 0 16px">Hello ${escapeHtml(name)},</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(intro)}</p>`,
    ...groups.map((g) =>
      `<h3 style="margin:16px 0 8px;font-size:14px">${URGENCY_LABEL[g.u]} (${g.rows.length})</h3><ul style="margin:0 0 16px;padding-left:20px">` +
      g.rows.map((i) => `<li><a href="${escapeHtml(url(i))}">${escapeHtml(`${i.code ? `${i.code} ` : ""}${i.title}`)}</a> — ${escapeHtml(i.sourceLabel)}, ${escapeHtml(dueText(i))}</li>`).join("") +
      `</ul>`),
    more > 0 ? `<p style="margin:0 0 16px">…and ${more} more in Vibes.</p>` : "",
    `<p style="margin:0 0 16px;font-size:12px;color:#6b7280">You receive this digest because these items are assigned to you in Vibes.</p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

/** AI intro through the feature runtime (recorded + audited), or the template when AI is off or fails. */
async function introFor(auth: AuthContext, items: DeadlineItem[], today: string, useAi: boolean): Promise<string> {
  if (!useAi) return templateIntro(items);
  try {
    const out = (await runAction({
      feature: FEATURE_KEY, action: "digest", auth, ip: null, input: {},
      def: {
        permission: "*", input: z.object({}),
        run: (ctx: AiActionContext<object>) => ctx.ai.text({ ...introPrompt(items, today), maxTokens: 400, target: { type: "deadline-digest", id: auth.userId } }),
      },
    })) as { text: string };
    return out.text.trim() || templateIntro(items);
  } catch (e) {
    console.warn(`[deadlines] AI intro failed for user ${auth.userId}; using the template:`, e instanceof Error ? e.message : e);
    return templateIntro(items);
  }
}

async function authFor(user: User, org: Organization): Promise<(AuthContext & { active: boolean })> {
  const access = await getEffectiveAccess(user.id);
  return {
    userId: user.id, orgId: user.orgId, tenantId: user.tenantId, orgType: org.type,
    isSuperAdmin: access.isSuperAdmin, actions: access.actionKeys, active: access.active,
  };
}

const recipientOf = (u: User, actions?: string[]): Recipient => ({ id: u.id, fullName: u.fullName, username: u.username, email: u.email, actions });

/** Send one org's digest: bell notifications (deduped per item per day) + one email per user. */
export async function digestOrg(org: Organization, today: string): Promise<{ users: number; emails: number; notifications: number }> {
  const items = await scanOrg(org.id, org.type, today);
  const stats = { users: 0, emails: 0, notifications: 0 };
  if (!items.length) return stats;
  const users = await User.findAll({ where: { orgId: org.id, status: "Active", system: false } });
  const auths = new Map(await Promise.all(users.map(async (u) => [u.id, await authFor(u, org)] as const)));
  const recipients = users.filter((u) => auths.get(u.id)!.active).map((u) => recipientOf(u, auths.get(u.id)!.actions));
  const perUser = assignItems(items, recipients);
  const useAi = await isAiAvailable();
  const since = new Date(Date.now() - 20 * 3_600_000);
  const sent = new Set((await Notification.findAll({
    where: { orgId: org.id, type: "deadline", createdAt: { [Op.gte]: since } }, attributes: ["userId", "text"],
  })).map((n) => `${n.userId}|${n.text}`));

  for (const user of users) {
    const mine = perUser.get(user.id);
    if (!mine?.length) continue;
    stats.users += 1;
    for (const item of mine.slice(0, MAX_NOTIFICATIONS)) {
      const text = itemLine(item).slice(0, 250);
      if (sent.has(`${user.id}|${text}`)) continue;
      await createNotification({ orgId: org.id, userId: user.id, type: "deadline", text, link: item.link });
      stats.notifications += 1;
    }
    if (!user.email) continue;
    const intro = await introFor(auths.get(user.id)!, mine, today, useAi);
    if (await sendMail({ to: user.email, ...digestEmail(user.fullName, intro, mine, env.APP_BASE_URL) })) stats.emails += 1;
  }
  return stats;
}

/** Local hour (0-23) in `tz`, falling back to the platform zone for an unknown name. */
export function hourInTz(tz: string, now = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  } catch {
    return hourInTz(DEFAULT_TZ, now);
  }
}

/**
 * The hourly schedule: each enabled org gets its digest once per local day, at
 * or after 07:00 org time. The per-org marker row is claimed before sending.
 * ponytail: a digest that fails after the claim is not retried until the next day; add a retry marker if that matters.
 */
export async function runDailyDigests(now = new Date()): Promise<string[]> {
  const done: string[] = [];
  const orgs = await Organization.findAll({ where: { status: "Active" }, attributes: ["id", "type", "systemDefaults"] });
  for (const org of orgs) {
    const tz = org.systemDefaults?.timezone || DEFAULT_TZ;
    if (hourInTz(tz, now) < DIGEST_HOUR) continue;
    if (!(await isFeatureEnabled(org.id, FEATURE_KEY))) continue;
    const day = todayInTz(tz, now);
    const claimed = await sequelize.query<{ key: string }>(
      `INSERT INTO ai_schedule_runs (key, last_run_at) VALUES (:k, NOW()) ON CONFLICT (key) DO NOTHING RETURNING key`,
      { replacements: { k: `${MARKER_PREFIX}${org.id}:${day}` }, type: QueryTypes.SELECT },
    );
    if (!claimed.length) continue;
    try {
      await digestOrg(org, day);
      done.push(org.id);
    } catch (e) {
      console.error(`[deadlines] digest failed for org ${org.id}:`, e);
    }
  }
  await sequelize.query(`DELETE FROM ai_schedule_runs WHERE key LIKE :p AND last_run_at < NOW() - INTERVAL '14 days'`, { replacements: { p: `${MARKER_PREFIX}%` } });
  return done;
}

/** The caller's own items (dashboard widget + digest-preview). */
export async function itemsForCaller(auth: AuthContext): Promise<{ today: string; items: DeadlineItem[] }> {
  const org = await Organization.findByPk(auth.orgId, { attributes: ["id", "type", "systemDefaults"] });
  const today = todayInTz(org?.systemDefaults?.timezone || DEFAULT_TZ);
  if (!org) return { today, items: [] };
  const items = await scanOrg(org.id, org.type, today);
  // Every org user is indexed so a name assigned to someone else never falls back to the caller's audience.
  const users = await User.findAll({ where: { orgId: org.id }, attributes: ["id", "fullName", "username", "email"] });
  const recipients = users.map((u) => recipientOf(u, u.id === auth.userId ? auth.actions : undefined));
  return { today, items: assignItems(items, recipients).get(auth.userId) ?? [] };
}
