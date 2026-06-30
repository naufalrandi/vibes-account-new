import { Op, type WhereOptions } from "sequelize";
import { Organization, User, TenantProfile, Ticket } from "../../db/models";
import type {
  TicketCategory, TicketPriority, TicketStatus, TicketScope,
  TicketMessage, TicketActivity,
} from "../../db/models/ticket.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

/** First-response SLA target (hours) by priority — the verified legacy values. */
const SLA_TARGETS: Record<TicketPriority, number> = { Low: 72, Medium: 24, High: 8, Critical: 4 };

type SlaStatus = "Pending" | "Met" | "Breached";
interface Sla { target: number; firstResponse: number | null; resolution: number | null; status: SlaStatus }

const hoursBetween = (from: string, to: string): number =>
  Math.round(((new Date(to).getTime() - new Date(from).getTime()) / 3_600_000) * 10) / 10;

/** Derive SLA metrics from the ticket's message + activity timestamps (read-only). */
function computeSla(t: Ticket): Sla {
  const target = SLA_TARGETS[t.priority as TicketPriority];
  const baseline = t.activity.find((a) => a.event === "Ticket created")?.ts ?? t.createdAt.toISOString();
  const firstSupport = t.messages.find((m) => m.author.kind === "support");
  const firstResponse = firstSupport ? hoursBetween(baseline, firstSupport.ts) : null;
  const resolvedAt = t.activity.filter((a) => /resolv|closed/i.test(a.event)).map((a) => a.ts).sort()[0];
  const resolution = resolvedAt ? hoursBetween(baseline, resolvedAt) : null;
  const status: SlaStatus = firstResponse == null ? "Pending" : firstResponse <= target ? "Met" : "Breached";
  return { target, firstResponse, resolution, status };
}

function toView(t: Ticket, orgName: string) {
  return {
    id: t.id, code: t.code, subject: t.subject, description: t.description,
    category: t.category, priority: t.priority, status: t.status, scope: t.scope,
    orgId: t.orgId, orgName, managedBy: t.managedBy, createdBy: t.createdBy, assignedTo: t.assignedTo,
    messages: t.messages, activity: t.activity, attachments: t.attachments,
    sla: computeSla(t), createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

const nowIso = () => new Date().toISOString();

/** Org ids whose tickets the actor may see (null = all). Distributor = self + child tenants. */
async function visibleOrgIds(auth: AuthContext): Promise<string[] | null> {
  if (auth.orgType === "ServiceOwner") return null;
  if (auth.orgType === "Tenant") return [auth.orgId];
  const children = await Organization.findAll({ where: { parentOrgId: auth.orgId, type: "Tenant" }, attributes: ["id"] });
  return [auth.orgId, ...children.map((o) => o.id)];
}

async function resolveTicket(auth: AuthContext, id: string): Promise<{ ticket: Ticket; orgName: string }> {
  const ticket = await Ticket.findByPk(id, { include: [{ model: Organization, attributes: ["name"] }] });
  if (!ticket) throw new NotFoundError("Ticket does not exist", "TICKET_NOT_FOUND");
  const ids = await visibleOrgIds(auth);
  if (ids !== null && !ids.includes(ticket.orgId)) throw new ForbiddenError();
  return { ticket, orgName: (ticket.get("Organization") as Organization | undefined)?.name ?? "—" };
}

async function nextCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const count = await Ticket.count({ where: { code: { [Op.like]: `${prefix}%` } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export interface ListFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  search?: string;
}

export async function listTickets(auth: AuthContext, filters: ListFilters = {}) {
  const where: WhereOptions = {};
  const ids = await visibleOrgIds(auth);
  if (ids !== null) Object.assign(where, { orgId: { [Op.in]: ids } });
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.priority) Object.assign(where, { priority: filters.priority });
  if (filters.category) Object.assign(where, { category: filters.category });
  if (filters.search) {
    const term = `%${filters.search}%`;
    Object.assign(where, { [Op.or]: [{ subject: { [Op.iLike]: term } }, { code: { [Op.iLike]: term } }] });
  }
  const rows = await Ticket.findAll({ where, include: [{ model: Organization, attributes: ["name"] }], order: [["updatedAt", "DESC"]] });
  return rows.map((t) => toView(t, (t.get("Organization") as Organization | undefined)?.name ?? "—"));
}

export async function getTicket(auth: AuthContext, id: string) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  return toView(ticket, orgName);
}

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: TicketCategory;
  priority?: TicketPriority;
}

export async function createTicket(auth: AuthContext, input: CreateTicketInput, ip: string | null) {
  const org = await Organization.findByPk(auth.orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");
  const actor = await User.findByPk(auth.userId);
  const createdBy = { name: actor?.fullName ?? actor?.username ?? "User", email: actor?.email ?? "" };

  const scope: TicketScope = auth.orgType === "ServiceOwner" ? "sp" : auth.orgType === "Distributor" ? "partner" : "tenant";
  let managedBy: string | null = null;
  if (auth.orgType === "Tenant") {
    const tp = await TenantProfile.findOne({ where: { orgId: org.id } });
    if (tp?.partnerOrgId) managedBy = (await Organization.findByPk(tp.partnerOrgId))?.name ?? null;
  }

  const ts = nowIso();
  const message: TicketMessage = { author: { name: createdBy.name, kind: "user" }, text: input.description, ts };
  const activity: TicketActivity[] = [{ event: "Ticket created", ts }];
  const ticket = await Ticket.create({
    code: await nextCode(), subject: input.subject, description: input.description,
    category: input.category, priority: input.priority ?? "Medium", status: "Open",
    scope, orgId: org.id, managedBy, createdBy, assignedTo: null,
    messages: [message], activity, attachments: [],
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: org.id, tenantId: org.tenantId, action: "ticket.created", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success" });
  return toView(ticket, org.name);
}

export async function replyTicket(auth: AuthContext, id: string, text: string, ip: string | null) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  if (ticket.status === "Closed") throw new ConflictError("Cannot reply to a closed ticket", "TICKET_CLOSED");
  const actor = await User.findByPk(auth.userId);
  // SP staff post as "support" (and their first reply starts the SLA clock); the
  // customer side (Distributor/Tenant) posts as "user".
  const kind = auth.orgType === "ServiceOwner" ? "support" : "user";
  const message: TicketMessage = { author: { name: actor?.fullName ?? "User", kind }, text, ts: nowIso() };
  ticket.messages = [...ticket.messages, message];
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.replied", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success" });
  return toView(ticket, orgName);
}

export async function setStatus(auth: AuthContext, id: string, status: TicketStatus, ip: string | null) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  const event = status === "Resolved" ? "Ticket resolved" : status === "Closed" ? "Ticket closed" : `Status changed to ${status}`;
  ticket.status = status;
  ticket.activity = [...ticket.activity, { event, ts: nowIso() }];
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.status", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success", metadata: { status } });
  return toView(ticket, orgName);
}

export async function assignTicket(auth: AuthContext, id: string, assignee: string | null, ip: string | null) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  const name = assignee?.trim() ? assignee.trim() : null;
  ticket.assignedTo = name;
  if (name) ticket.activity = [...ticket.activity, { event: `Assigned to ${name}`, ts: nowIso() }];
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.assigned", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success", metadata: { assignee: name } });
  return toView(ticket, orgName);
}
