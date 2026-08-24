import { Op, type WhereOptions } from "sequelize";
import { Organization, User, Role, TenantProfile, Ticket } from "../../db/models";
import type {
  TicketCategory, TicketPriority, TicketStatus, TicketScope,
  TicketMessage, TicketActivity,
} from "../../db/models/ticket.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { createNotification } from "../notifications/notification.service";
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
  attachments?: { name: string; size: number }[];
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
    messages: [message], activity,
    attachments: (input.attachments ?? []).map((a) => ({ name: String(a.name), size: Number(a.size) || 0, date: ts })),
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: org.id, tenantId: org.tenantId, action: "ticket.created", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success" });
  await createNotification({ orgId: org.id, type: "ticket", text: `New ticket: ${ticket.subject}`, link: `/tickets/${ticket.id}` });
  return toView(ticket, org.name);
}

export async function replyTicket(auth: AuthContext, id: string, text: string, ip: string | null) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  if (ticket.status === "Closed") throw new ConflictError("Cannot reply to a closed ticket", "TICKET_CLOSED");
  const actor = await User.findByPk(auth.userId);
  // SP staff post as "support" (and their first reply starts the SLA clock); the
  // customer side (Distributor/Tenant) posts as "user".
  const kind = auth.orgType === "ServiceOwner" ? "support" : "user";
  const authorName = actor?.fullName ?? "User";
  const message: TicketMessage = { author: { name: authorName, kind }, text, ts: nowIso() };
  ticket.messages = [...ticket.messages, message];
  ticket.activity = [...ticket.activity, { event: `Reply posted by ${authorName}`, ts: nowIso() }];
  // A customer reply re-opens a ticket that was waiting on them.
  if (kind === "user" && ticket.status === "Waiting for Customer") ticket.status = "In Progress";
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.replied", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success" });
  await createNotification({ orgId: ticket.orgId, type: "ticket", text: `New reply on ${ticket.code} — ${ticket.subject}`, link: `/tickets/${ticket.id}` });
  return toView(ticket, orgName);
}

/** Attach a file's metadata (name/size) to a ticket (no file storage; mirrors the design). */
export async function addAttachment(auth: AuthContext, id: string, name: string, size: number, ip: string | null) {
  const { ticket, orgName } = await resolveTicket(auth, id);
  if (ticket.status === "Closed") throw new ConflictError("Cannot attach to a closed ticket", "TICKET_CLOSED");
  const clean = name.trim();
  if (!clean) throw new BadRequestError("Attachment name is required", "NAME_REQUIRED");
  ticket.attachments = [...ticket.attachments, { name: clean, size: Number.isFinite(size) ? size : 0, date: nowIso() }];
  ticket.activity = [...ticket.activity, { event: `Attachment added: ${clean}`, ts: nowIso() }];
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.attached", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success" });
  return toView(ticket, orgName);
}

export async function setStatus(auth: AuthContext, id: string, status: TicketStatus, ip: string | null) {
  // P0-6 / B2: status changes are a Service-Provider-only control in OD
  // (index.html:15589). The seeded Distributor/Tenant admin roles used to
  // carry ticket.manage via grantEverything with no server-side backstop —
  // FE hid the controls, but the API itself allowed it.
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner changes ticket status");
  const { ticket, orgName } = await resolveTicket(auth, id);
  const event = status === "Resolved" ? "Ticket resolved" : status === "Closed" ? "Ticket closed" : `Status changed to ${status}`;
  ticket.status = status;
  ticket.activity = [...ticket.activity, { event, ts: nowIso() }];
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.status", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success", metadata: { status } });
  await createNotification({ orgId: ticket.orgId, type: "ticket", text: `Ticket ${ticket.code} status: ${status}`, link: `/tickets/${ticket.id}` });
  return toView(ticket, orgName);
}

/**
 * OD `spAgents()` (app.html:26541): the assignable roster for the ticket
 * Assign modal — Active users, in the actor's own (Service-Owner) org, whose
 * role is Administrator or Technical Support. Service-Owner only, same gate
 * as assignTicket/setStatus above.
 */
export async function listAgents(auth: AuthContext): Promise<string[]> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner has an agent roster");
  const rows = await User.findAll({
    where: { orgId: auth.orgId, status: "Active" },
    include: [{ model: Role, where: { name: { [Op.in]: ["Administrator", "Technical Support"] } }, required: true, through: { attributes: [] } }],
  });
  return rows.map((u) => u.fullName).sort((a, b) => a.localeCompare(b));
}

export async function assignTicket(auth: AuthContext, id: string, assignee: string | null, ip: string | null) {
  // P0-6 / B2: assignment is a Service-Provider-only control in OD (index.html:15592) — same rationale as setStatus above.
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner assigns tickets");
  const { ticket, orgName } = await resolveTicket(auth, id);
  const name = assignee?.trim() ? assignee.trim() : null;
  ticket.assignedTo = name;
  if (name) {
    ticket.activity = [...ticket.activity, { event: `Assigned to ${name}`, ts: nowIso() }];
    // Assigning an unstarted ticket moves it into progress.
    if (ticket.status === "Open") ticket.status = "In Progress";
  }
  await ticket.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: ticket.orgId, action: "ticket.assigned", entityType: "Ticket", entityId: ticket.id, sourceIp: ip, result: "Success", metadata: { assignee: name } });
  if (name) await createNotification({ orgId: ticket.orgId, type: "ticket", text: `Ticket ${ticket.code} assigned to ${name}`, link: `/tickets/${ticket.id}` });
  return toView(ticket, orgName);
}
