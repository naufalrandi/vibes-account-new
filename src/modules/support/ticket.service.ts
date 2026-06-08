import { Op, type WhereOptions } from "sequelize";
import { Organization, Ticket, User } from "../../db/models";
import type { TicketCategory, TicketPriority, TicketScope, TicketStatus, TicketMessage, TicketActivity } from "../../db/models/ticket.model";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "../../db/models/ticket.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: TicketCategory;
  priority?: TicketPriority;
}

export interface ListTicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  search?: string;
}

/** SLA status mirrors the AXIA mockup: derived from message/activity timestamps. */
export type TicketSlaStatus = "Pending" | "Met" | "Breached";
export interface TicketSla {
  target: number;                 // target first-response hours for the priority
  firstResponse: number | null;   // actual first-response hours (null until support replies)
  resolution: number | null;      // hours from creation to resolved/closed (null if open)
  status: TicketSlaStatus;
}

export interface TicketView {
  id: string;
  code: string;
  subject: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  scope: TicketScope;
  orgId: string;
  orgName: string;
  managedBy: string | null;
  createdBy: { name: string; email: string };
  assignedTo: string | null;
  messages: TicketMessage[];
  activity: TicketActivity[];
  attachments: { name: string; size: number; date: string }[];
  sla: TicketSla;
  createdAt: string;
  updatedAt: string;
}

/** First-response SLA targets (hours) per priority — platform defaults. */
const SLA_TARGETS: Record<TicketPriority, number> = { Low: 72, Medium: 24, High: 8, Critical: 4 };

function hoursBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 3_600_000));
}

/** Creation baseline = the "Ticket created" activity timestamp (carries the real
 *  event time); falls back to the row's createdAt. */
function createdBaseline(t: Ticket): string {
  const ev = t.activity.find((a) => /created/i.test(a.event));
  return ev ? ev.ts : t.createdAt.toISOString();
}

function slaInfo(t: Ticket): TicketSla {
  const target = SLA_TARGETS[t.priority as TicketPriority] ?? 24;
  const base = createdBaseline(t);
  const firstSupport = t.messages.find((m) => m.author.kind === "support");
  let resolvedTs: string | null = null;
  for (const a of t.activity) {
    if (/resolv|closed/i.test(a.event) && (!resolvedTs || new Date(a.ts) < new Date(resolvedTs))) resolvedTs = a.ts;
  }
  const firstResponse = firstSupport ? hoursBetween(base, firstSupport.ts) : null;
  const resolution = resolvedTs ? hoursBetween(base, resolvedTs) : null;
  const status: TicketSlaStatus = firstResponse == null ? "Pending" : firstResponse <= target ? "Met" : "Breached";
  return { target, firstResponse, resolution, status };
}

function isServiceOwner(auth: AuthContext): boolean {
  return auth.orgType === "ServiceOwner";
}

function scopeFor(orgType: AuthContext["orgType"]): TicketScope {
  return orgType === "ServiceOwner" ? "sp" : orgType === "Distributor" ? "partner" : "tenant";
}

function toView(t: Ticket): TicketView {
  return {
    id: t.id,
    code: t.code,
    subject: t.subject,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    scope: t.scope,
    orgId: t.orgId,
    orgName: t.orgName,
    managedBy: t.managedBy,
    createdBy: t.createdBy,
    assignedTo: t.assignedTo,
    messages: t.messages,
    activity: t.activity,
    attachments: t.attachments,
    sla: slaInfo(t),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Next ticket code in the TKT-2026-#### sequence (starts at 0001). */
async function nextTicketCode(): Promise<string> {
  const rows = await Ticket.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const m = /TKT-2026-(\d+)/.exec(r.code || "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `TKT-2026-${String(max + 1).padStart(4, "0")}`;
}

/** The org ids a caller may see tickets for. SO sees all (returns null = no filter). */
async function visibleOrgIds(auth: AuthContext): Promise<string[] | null> {
  if (isServiceOwner(auth)) return null;
  if (auth.orgType === "Distributor") {
    const tenants = await Organization.findAll({ where: { parentOrgId: auth.orgId, type: "Tenant" }, attributes: ["id"] });
    return [auth.orgId, ...tenants.map((t) => t.id)];
  }
  return [auth.orgId];
}

export async function listTickets(auth: AuthContext, filters: ListTicketFilters = {}): Promise<TicketView[]> {
  const where: WhereOptions = {};
  const ids = await visibleOrgIds(auth);
  if (ids) {
    if (ids.length === 0) return [];
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.priority) Object.assign(where, { priority: filters.priority });
  if (filters.category) Object.assign(where, { category: filters.category });
  if (filters.search) {
    const term = `%${filters.search}%`;
    Object.assign(where, { [Op.or]: [{ subject: { [Op.iLike]: term } }, { code: { [Op.iLike]: term } }] });
  }
  const rows = await Ticket.findAll({ where, order: [["updatedAt", "DESC"]] });
  return rows.map(toView);
}

async function requireVisible(auth: AuthContext, id: string): Promise<Ticket> {
  const t = await Ticket.findByPk(id);
  if (!t) throw new NotFoundError("Ticket does not exist", "TICKET_NOT_FOUND");
  const ids = await visibleOrgIds(auth);
  if (ids && !ids.includes(t.orgId)) throw new NotFoundError("Ticket does not exist", "TICKET_NOT_FOUND");
  return t;
}

export async function getTicket(auth: AuthContext, id: string): Promise<TicketView> {
  return toView(await requireVisible(auth, id));
}

export async function createTicket(auth: AuthContext, input: CreateTicketInput, ip: string | null): Promise<TicketView> {
  if (!TICKET_CATEGORIES.includes(input.category)) throw new BadRequestError(`Invalid category: ${input.category}`, "INVALID_CATEGORY");
  if (input.priority && !TICKET_PRIORITIES.includes(input.priority)) throw new BadRequestError(`Invalid priority: ${input.priority}`, "INVALID_PRIORITY");

  const org = await Organization.findByPk(auth.orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");
  const user = await User.findByPk(auth.userId);
  const creatorName = user?.fullName ?? "Unknown";
  const creatorEmail = user?.email ?? "";

  // A tenant ticket is "managed by" its acquiring partner (distributor parent).
  let managedBy: string | null = null;
  if (org.type === "Tenant" && org.parentOrgId) {
    const parent = await Organization.findByPk(org.parentOrgId);
    if (parent?.type === "Distributor") managedBy = parent.name;
  }

  const now = new Date().toISOString();
  const t = await Ticket.create({
    code: await nextTicketCode(),
    subject: input.subject,
    description: input.description,
    category: input.category,
    priority: input.priority ?? "Medium",
    status: "Open",
    scope: scopeFor(auth.orgType),
    orgId: org.id,
    orgName: org.name,
    managedBy,
    createdBy: { name: creatorName, email: creatorEmail },
    assignedTo: null,
    messages: input.description ? [{ author: { name: creatorName, kind: "user" }, text: input.description, ts: now }] : [],
    activity: [{ event: "Ticket created", ts: now }],
    attachments: [],
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: org.id, tenantId: auth.tenantId, action: "ticket.created", entityType: "Ticket", entityId: t.id, sourceIp: ip, result: "Success" });
  return toView(t);
}

export async function replyTicket(auth: AuthContext, id: string, text: string, ip: string | null): Promise<TicketView> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new BadRequestError("Reply text is required", "EMPTY_REPLY");
  const t = await requireVisible(auth, id);
  if (t.status === "Closed") throw new BadRequestError("Cannot reply to a closed ticket", "TICKET_CLOSED");

  const user = await User.findByPk(auth.userId);
  const name = user?.fullName ?? "Unknown";
  const kind: "user" | "support" = isServiceOwner(auth) ? "support" : "user";
  const now = new Date().toISOString();
  // JSONB arrays must be reassigned (not mutated) for Sequelize to persist them.
  t.messages = [...t.messages, { author: { name, kind }, text: trimmed, ts: now }];
  // A customer reply on a "Waiting for Customer" ticket moves it back to In Progress.
  if (kind === "user" && t.status === "Waiting for Customer") {
    t.status = "In Progress";
    t.activity = [...t.activity, { event: "Status changed to In Progress", ts: now }];
  }
  await t.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: t.orgId, tenantId: auth.tenantId, action: "ticket.replied", entityType: "Ticket", entityId: t.id, sourceIp: ip, result: "Success" });
  return toView(t);
}

export async function setTicketStatus(auth: AuthContext, id: string, status: TicketStatus, ip: string | null): Promise<TicketView> {
  if (!isServiceOwner(auth)) throw new ForbiddenError("Only the Service Owner can change ticket status");
  if (!TICKET_STATUSES.includes(status)) throw new BadRequestError(`Invalid status: ${status}`, "INVALID_STATUS");
  const t = await requireVisible(auth, id);
  const now = new Date().toISOString();
  t.status = status;
  const event = status === "Resolved" ? "Ticket resolved" : status === "Closed" ? "Ticket closed" : `Status changed to ${status}`;
  t.activity = [...t.activity, { event, ts: now }];
  await t.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: t.orgId, action: "ticket.status_changed", entityType: "Ticket", entityId: t.id, sourceIp: ip, result: "Success", metadata: { status } });
  return toView(t);
}

export async function assignTicket(auth: AuthContext, id: string, assignee: string | null, ip: string | null): Promise<TicketView> {
  if (!isServiceOwner(auth)) throw new ForbiddenError("Only the Service Owner can assign tickets");
  const t = await requireVisible(auth, id);
  const now = new Date().toISOString();
  t.assignedTo = assignee && assignee.trim() ? assignee.trim() : null;
  if (t.assignedTo) t.activity = [...t.activity, { event: `Assigned to ${t.assignedTo}`, ts: now }];
  await t.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: t.orgId, action: "ticket.assigned", entityType: "Ticket", entityId: t.id, sourceIp: ip, result: "Success" });
  return toView(t);
}
