import { Op } from "sequelize";
import {
  ApprovalRecord, BusinessRecord, CompetenceAssessment, CompetenceGap, IaFinding, IaProgram, ImplementationRecord,
  Invoice, IsraRtp, IsraRtpAction, IsraScenario, MReview, Organization, PartnerAgreement, PersonnelContractDocument,
  PersonnelProfile, ResumeRecord, SaasSubscription, User,
} from "../../../db/models";
import { ACTIONS } from "../../iam/actions.catalog";

/**
 * Deterministic deadline scanner (no AI): every due / overdue / waiting item of
 * one org, with the people responsible for it. Used by the `deadline-agent`
 * daily digest (worker) and the "My deadlines" dashboard widget.
 *
 * Each source reads its module's real due field; a source whose table or field
 * is missing (or that throws) is skipped with a warning so one broken register
 * never blocks the whole digest.
 */

export type Urgency = "overdue" | "today" | "week" | "later";

export interface DeadlineItem {
  /** Stable per item (and per sub-item, e.g. one acknowledgement): dedupe key. */
  key: string;
  source: string;
  sourceLabel: string;
  code: string | null;
  title: string;
  due: string; // YYYY-MM-DD
  daysLeft: number;
  urgency: Urgency;
  link: string;
  /** User ids, full names, usernames or emails — as the module stores them. */
  assignees: string[];
  /** When no assignee resolves to a user: everyone in the org holding this action key. */
  audience?: string;
}

export const HORIZON_DAYS = 14;
const LEAD_UNASSIGNED_DAYS = 2;
const DONE_RE =
  /^(closed|cancel+ed|archived|completed?|verified|done|resolved|superseded|obsolete|retired|withdrawn|finali[sz]ed|rejected|revoked|achieved|implemented|waived|not required|paid|purged|terminated|meets requirement|acknowledged)$/i;

export const isDone = (status: unknown): boolean => typeof status === "string" && DONE_RE.test(status.trim());

/** `YYYY-MM-DD` from a date-ish value, else null. */
export function toDay(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m && !Number.isNaN(Date.parse(m[1])) ? m[1] : null;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
}

export function urgencyOf(daysLeft: number): Urgency {
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  return daysLeft <= 7 ? "week" : "later";
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Draft extends Omit<DeadlineItem, "daysLeft" | "urgency" | "assignees"> {
  assignees: unknown[];
  /** Waiting items (approvals, leads) are always in; dated items only up to the horizon. */
  always?: boolean;
}

// ---- Implementation registers (implementation_records.data) --------------------------------

const IMPL_LINK: Record<string, string> = {
  documents: "/implementation/documents",
  policies: "/implementation/policies",
  nonconformities: "/implementation/issues",
  capa: "/ms-module/tn-m-capa",
  reviews: "/implementation/reviews",
  training: "/implementation/training",
  suppliers: "/implementation/suppliers",
  "lab-equipment": "/ms-module/tn-m-lab-equipment",
  mmr: "/ms-module/tn-m-mmr",
  "cab-clients": "/implementation/cab-clients",
  "pcb-persons": "/implementation/pcb-persons",
  "awareness-campaigns": "/implementation/awareness",
};

function implDrafts(r: ImplementationRecord, today: string): Draft[] {
  const d = obj(r.data);
  const base = { code: r.code, title: r.title, link: IMPL_LINK[r.module] ?? `/implementation/${r.module}`, audience: ACTIONS.MS_MANAGE };
  const own = [r.owner];
  const one = (suffix: string, source: string, sourceLabel: string, due: unknown, assignees: unknown[] = own): Draft[] => {
    const day = toDay(due);
    return day ? [{ ...base, key: `${source}:${r.id}${suffix}`, source, sourceLabel, due: day, assignees }] : [];
  };
  switch (r.module) {
    case "documents":
    case "policies": {
      const label = r.module === "documents" ? "Document review" : "Policy review";
      if (r.status === "Review Due") return one("", `${r.module}-review`, label, d.nextReview ?? today);
      return ["Published", "Approved"].includes(r.status) ? one("", `${r.module}-review`, label, d.nextReview) : [];
    }
    case "nonconformities": {
      const cap = obj(d.cap);
      const people = [d.pic, cap.pic, r.owner];
      const out = r.status === "Pending Effectiveness Check" ? [] : one("", "nc-due", "Nonconformity / CAP due", d.due ?? cap.due, people);
      if (cap.effRequired && !str(cap.effResult)) out.push(...one(":eff", "cap-effectiveness", "CAP effectiveness check", cap.effDue, [cap.effBy, ...people]));
      return out;
    }
    case "capa":
      return one("", "capa-due", "CAPA due", d.due ?? d.targetDate, [d.pic, r.owner]);
    case "reviews":
      return mrTopicDrafts(arr(d.topics), `${r.id}`, { code: r.code, title: r.title, link: base.link });
    case "training": {
      if (d.completionDate && !d.reassessRequired) return [];
      const people = [r.owner, d.memberId, d.memberName];
      const out = d.completionDate ? [] : one("", "training-due", "Training due", d.due, people);
      if (d.reassessRequired && !str(d.reassessResult)) out.push(...one(":reassess", "training-reassess", "Training reassessment", d.reassessDue, people));
      return out;
    }
    case "suppliers":
      return r.status === "Approved" ? one("", "supplier-requal", "Supplier requalification", d.requalDate) : [];
    case "lab-equipment":
    case "mmr":
      return one("", "calibration", "Calibration due", d.nextCalibration ?? d.calibrationDue ?? (r.status === "Calibration Due" ? today : null));
    case "cab-clients":
      return one("", "cab-surveillance", "CAB surveillance due", d.nextSurveillance ?? (r.status === "Surveillance Due" ? today : null));
    case "pcb-persons":
      return one("", "pcb-recert", "Person recertification due", d.expiry ?? (r.status === "Recert Due" ? today : null));
    case "awareness-campaigns":
      return arr(d.acks).flatMap((raw) => {
        const a = obj(raw);
        if (!["Pending", "Overdue"].includes(String(a.status))) return [];
        return one(`:${String(a.id ?? a.memberId)}`, "awareness-ack", "Awareness acknowledgement", a.due ?? d.dueDate ?? d.due, [a.memberId, a.memberName]);
      });
    default:
      return [];
  }
}

function mrTopicDrafts(topics: unknown[], id: string, base: { code: string | null; title: string; link: string }): Draft[] {
  return topics.flatMap((raw) => {
    const t = obj(raw);
    const action = obj(t.action);
    const due = toDay(action.due ?? t.due);
    if (!due || isDone(action.status) || isDone(t.itemStatus)) return [];
    return [{
      ...base, key: `mr-action:${id}:${String(t.id ?? t.title)}`, source: "mr-action", sourceLabel: "Management review action",
      title: `${str(action.title) ?? str(t.title) ?? "Action"} (${base.title})`, due, assignees: [action.owner, t.responsible], audience: ACTIONS.MREVIEW_MANAGE,
    }];
  });
}

async function implementationSource(orgId: string, today: string): Promise<Draft[]> {
  const rows = await ImplementationRecord.findAll({
    where: { orgId, module: Object.keys(IMPL_LINK) },
    attributes: ["id", "module", "code", "title", "status", "owner", "data"],
  });
  return rows.filter((r) => !isDone(r.status)).flatMap((r) => implDrafts(r, today));
}

// ---- Dedicated tables ----------------------------------------------------------------------

async function mReviewSource(orgId: string): Promise<Draft[]> {
  const rows = await MReview.findAll({ where: { orgId }, attributes: ["id", "code", "title", "status", "topics"] });
  return rows.filter((r) => !isDone(r.status)).flatMap((r) =>
    mrTopicDrafts(arr(r.topics), r.id, { code: r.code, title: r.title ?? r.code, link: "/implementation/reviews" }));
}

async function internalAuditSource(orgId: string, today: string): Promise<Draft[]> {
  const rows = await IaFinding.findAll({
    where: { orgId, [Op.or]: [{ issueStatus: "Issued" }, { reviewStatus: "Pending Lead Auditor Review" }] },
    attributes: ["id", "code", "title", "programId", "pic", "due", "issueStatus", "reviewStatus", "linkedNC", "updatedAt"],
  });
  const programIds = [...new Set(rows.map((r) => r.programId))];
  const leads = new Map((await IaProgram.findAll({ where: { orgId, id: programIds }, attributes: ["id", "leadAuditor"] })).map((p) => [p.id, p.leadAuditor]));
  const base = { link: "/internal-audit", audience: ACTIONS.IAUDIT_MANAGE };
  return rows.flatMap((f): Draft[] => {
    if (f.reviewStatus === "Pending Lead Auditor Review") {
      return [{ ...base, key: `ia-review:${f.id}`, source: "ia-review", sourceLabel: "Audit finding awaiting review", code: f.code, title: f.title, due: toDay(f.updatedAt) ?? today, assignees: [leads.get(f.programId)], always: true }];
    }
    const due = toDay(f.due);
    return due && !f.linkedNC ? [{ ...base, key: `ia-finding:${f.id}`, source: "ia-finding", sourceLabel: "Audit finding due", code: f.code, title: f.title, due, assignees: [f.pic] }] : [];
  });
}

async function israSource(orgId: string): Promise<Draft[]> {
  const scenarios = await IsraScenario.findAll({ where: { orgId }, attributes: ["id", "code", "title", "status", "reviewDue", "createdBy"] });
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const link = "/implementation/isra";
  const out: Draft[] = scenarios.flatMap((s): Draft[] => {
    const due = toDay(s.reviewDue);
    return due && !isDone(s.status)
      ? [{ key: `isra-review:${s.id}`, source: "isra-review", sourceLabel: "Risk scenario review", code: s.code, title: s.title, due, link, assignees: [s.createdBy], audience: ACTIONS.MS_MANAGE }]
      : [];
  });
  if (!scenarios.length) return out;
  const rtps = await IsraRtp.findAll({ where: { scenarioId: [...byId.keys()], isCurrent: true }, attributes: ["id", "scenarioId", "owner", "title"] });
  const rtpById = new Map(rtps.map((r) => [r.id, r]));
  if (!rtps.length) return out;
  const actions = await IsraRtpAction.findAll({ where: { rtpId: [...rtpById.keys()] }, attributes: ["id", "rtpId", "action", "owners", "targetDate", "status"] });
  for (const a of actions) {
    const due = toDay(a.targetDate);
    const rtp = rtpById.get(a.rtpId);
    if (!due || !rtp || isDone(a.status)) continue;
    const s = byId.get(rtp.scenarioId);
    out.push({
      key: `rtp-action:${a.id}`, source: "rtp-action", sourceLabel: "Risk treatment action", code: s?.code ?? null,
      title: a.action, due, link, assignees: [...arr(a.owners), rtp.owner], audience: ACTIONS.MS_MANAGE,
    });
  }
  return out;
}

async function competenceSource(orgId: string): Promise<Draft[]> {
  const link = "/competence?tab=assessments";
  const gaps = await CompetenceGap.findAll({ where: { orgId }, attributes: ["id", "code", "reqLabel", "reqKey", "owner", "due", "status", "personId"] });
  const out: Draft[] = gaps.flatMap((g): Draft[] => {
    const due = toDay(g.due);
    return due && !isDone(g.status)
      ? [{ key: `competence-gap:${g.id}`, source: "competence-gap", sourceLabel: "Competence gap action", code: g.code, title: g.reqLabel ?? g.reqKey, due, link, assignees: [g.owner], audience: ACTIONS.COMPETENCE_MANAGE }]
      : [];
  });
  const assessments = await CompetenceAssessment.findAll({ where: { orgId, validUntil: { [Op.ne]: null } }, attributes: ["id", "code", "personId", "assessor", "validUntil", "status"] });
  for (const a of assessments) {
    const due = toDay(a.validUntil);
    if (due) out.push({ key: `competence-reassess:${a.id}`, source: "competence-reassess", sourceLabel: "Competence reassessment", code: a.code, title: `Reassessment ${a.code}`, due, link, assignees: [a.assessor, a.personId], audience: ACTIONS.COMPETENCE_MANAGE });
  }
  return out;
}

async function personnelSource(orgId: string): Promise<Draft[]> {
  const users = await User.findAll({ where: { orgId }, attributes: ["id", "fullName"] });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const out: Draft[] = [];
  const certs = await ResumeRecord.findAll({ where: { orgId, expiryDate: { [Op.ne]: null } }, attributes: ["id", "userId", "title", "expiryDate"] });
  for (const c of certs) {
    const due = toDay(c.expiryDate);
    if (due) out.push({ key: `cert-expiry:${c.id}`, source: "cert-expiry", sourceLabel: "Certificate expiry", code: null, title: `${c.title} (${names.get(c.userId) ?? "team member"})`, due, link: `/users/${c.userId}`, assignees: [c.userId] });
  }
  const contracts = await PersonnelContractDocument.findAll({ where: { orgId, status: "Signed", expiryDate: { [Op.ne]: null } }, attributes: ["id", "userId", "title", "expiryDate"] });
  for (const c of contracts) {
    const due = toDay(c.expiryDate);
    if (due) out.push({ key: `contract-expiry:${c.id}`, source: "contract-expiry", sourceLabel: "Contract expiry", code: null, title: `${c.title} (${names.get(c.userId) ?? "team member"})`, due, link: `/users/${c.userId}`, assignees: [], audience: ACTIONS.PERSONNEL_CONTRACTDOC_MANAGE });
  }
  if (!users.length) return out;
  const profiles = await PersonnelProfile.findAll({ where: { userId: [...names.keys()] }, attributes: ["id", "userId", "managerId", "probationEndDate", "contractEndDate"] });
  for (const p of profiles) {
    const who = names.get(p.userId) ?? "team member";
    const probation = toDay(p.probationEndDate);
    const end = toDay(p.contractEndDate);
    const base = { code: null, link: `/users/${p.userId}`, assignees: [p.managerId], audience: ACTIONS.PERSONNEL_CONTRACTDOC_MANAGE };
    if (probation) out.push({ ...base, key: `probation-end:${p.id}`, source: "probation-end", sourceLabel: "Probation ends", title: who, due: probation });
    if (end) out.push({ ...base, key: `contract-end:${p.id}`, source: "contract-end", sourceLabel: "Contract ends", title: who, due: end });
  }
  return out;
}

async function approvalSource(orgId: string, today: string): Promise<Draft[]> {
  const rows = await ApprovalRecord.findAll({ where: { orgId, state: "active" }, attributes: ["id", "module", "recordId", "gateIdx", "gates", "updatedAt"] });
  if (!rows.length) return [];
  const recs = new Map((await ImplementationRecord.findAll({ where: { orgId, id: rows.map((r) => r.recordId) }, attributes: ["id", "code", "title", "module"] })).map((r) => [r.id, r]));
  return rows.map((a): Draft => {
    // Newer runs also carry eligibleIds / approvals[].userId (approval.service `Gate`).
    const gate = (a.gates ?? [])[a.gateIdx] as { label?: string; eligible?: string[]; eligibleIds?: string[]; approvals?: { by: string; userId?: string }[] } | undefined;
    const signed = new Set((gate?.approvals ?? []).flatMap((s) => [s.by, s.userId]));
    const waiting = (gate?.eligibleIds ?? gate?.eligible ?? []).filter((x) => !signed.has(x));
    const rec = recs.get(a.recordId);
    return {
      key: `approval:${a.id}:${a.gateIdx}`, source: "approval", sourceLabel: `Approval waiting${gate?.label ? ` — ${gate.label}` : ""}`,
      code: rec?.code ?? null, title: rec?.title ?? `${a.module} record`, due: toDay(a.updatedAt) ?? today,
      link: `/implementation/${a.module}`, assignees: waiting, always: true,
    };
  });
}

/** Service Owner only: SaaS renewals, unpaid invoices, partner agreements, stale unassigned leads. */
async function serviceProviderSource(orgId: string, today: string): Promise<Draft[]> {
  const out: Draft[] = [];
  const subs = await SaasSubscription.findAll({ where: { renewalDate: { [Op.ne]: null }, archivedAt: null }, attributes: ["id", "code", "tenantId", "renewalDate", "status", "autoRenew"] });
  for (const s of subs) {
    const due = toDay(s.renewalDate);
    if (due && !isDone(s.status)) out.push({ key: `saas-renewal:${s.id}`, source: "saas-renewal", sourceLabel: s.autoRenew ? "SaaS auto-renewal" : "SaaS renewal", code: s.code, title: `Subscription ${s.code}`, due, link: "/billing/saas-subscriptions", assignees: [], audience: ACTIONS.SAAS_MANAGE });
  }
  const invoices = await Invoice.findAll({ where: { status: "Unpaid", dueDate: { [Op.ne]: null } }, attributes: ["id", "number", "orgId", "dueDate"], include: [{ model: Organization, attributes: ["name"] }] });
  for (const i of invoices) {
    const due = toDay(i.dueDate);
    const org = i.get("Organization") as Organization | undefined;
    if (due) out.push({ key: `invoice-due:${i.id}`, source: "invoice-due", sourceLabel: "Invoice due", code: i.number, title: `${i.number}${org ? ` — ${org.name}` : ""}`, due, link: `/tenants/${i.orgId}`, assignees: [], audience: ACTIONS.BILLING_MANAGE });
  }
  const agreements = await PartnerAgreement.findAll({ where: { status: "Approved", expirationDate: { [Op.ne]: null } }, attributes: ["id", "number", "templateName", "expirationDate"] });
  for (const a of agreements) {
    const due = toDay(a.expirationDate);
    if (due) out.push({ key: `agreement-expiry:${a.id}`, source: "agreement-expiry", sourceLabel: "Partner agreement expiry", code: a.number, title: a.templateName, due, link: "/partnership-agreements", assignees: [], audience: ACTIONS.AGREEMENT_UPDATE });
  }
  out.push(...(await leadSource(orgId, today)));
  return out;
}

async function leadSource(orgId: string, today: string): Promise<Draft[]> {
  const cutoff = new Date(Date.parse(addDays(today, -LEAD_UNASSIGNED_DAYS + 1)));
  const rows = await BusinessRecord.findAll({
    where: { orgId, area: "enterprise", module: "ent-inq", createdAt: { [Op.lt]: cutoff } },
    attributes: ["id", "code", "title", "data", "createdAt"],
  });
  return rows.filter((r) => obj(r.data).lifecycle === "Unassigned").map((r) => ({
    key: `lead-unassigned:${r.id}`, source: "lead-unassigned", sourceLabel: `Lead unassigned > ${LEAD_UNASSIGNED_DAYS} days`, code: r.code, title: r.title,
    due: addDays(toDay(r.createdAt)!, LEAD_UNASSIGNED_DAYS), link: "/platform/enterprise/ent-inq", assignees: [], audience: ACTIONS.BUSINESS_MANAGE, always: true,
  }));
}

// ---- Assembly -----------------------------------------------------------------------------

type Source = (orgId: string, today: string) => Promise<Draft[]>;
const SOURCES: Record<string, Source> = {
  implementation: implementationSource,
  managementReview: mReviewSource,
  internalAudit: internalAuditSource,
  isra: israSource,
  competence: competenceSource,
  personnel: personnelSource,
  approvals: approvalSource,
};

/** Keep dated items up to the horizon (overdue included), fill urgency, clean assignees. */
export function finalize(drafts: Draft[], today: string): DeadlineItem[] {
  const horizon = addDays(today, HORIZON_DAYS);
  const seen = new Set<string>();
  const out: DeadlineItem[] = [];
  for (const { always, assignees, ...d } of drafts) {
    if (seen.has(d.key) || (!always && d.due > horizon)) continue;
    seen.add(d.key);
    const daysLeft = daysBetween(today, d.due);
    out.push({ ...d, daysLeft, urgency: urgencyOf(daysLeft), assignees: [...new Set(assignees.map(str).filter((a): a is string => !!a))] });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

/** Every due / overdue / waiting item of `orgId` as of `today` (org-local YYYY-MM-DD). */
export async function scanOrg(orgId: string, orgType: string, today: string): Promise<DeadlineItem[]> {
  const sources = orgType === "ServiceOwner" ? { ...SOURCES, serviceProvider: serviceProviderSource } : SOURCES;
  const drafts = await Promise.all(Object.entries(sources).map(async ([name, run]) => {
    try {
      return await run(orgId, today);
    } catch (e) {
      console.warn(`[deadlines] source "${name}" skipped for org ${orgId}:`, e instanceof Error ? e.message : e);
      return [];
    }
  }));
  return finalize(drafts.flat(), today);
}

export interface Recipient {
  id: string;
  fullName: string;
  username: string;
  email: string;
  /** Effective action keys, needed only for audience fallback. */
  actions?: string[];
  isSuperAdmin?: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Items per user: an item goes to every user its assignees resolve to (by id,
 * full name, username or email); an item nobody resolves for goes to its
 * audience (users holding that action key; super-admins excluded to avoid
 * flooding them with every org-wide item).
 */
export function assignItems(items: DeadlineItem[], users: Recipient[]): Map<string, DeadlineItem[]> {
  const index = new Map<string, string>();
  for (const u of users) for (const k of [u.id, u.fullName, u.username, u.email]) if (k) index.set(norm(k), u.id);
  const out = new Map<string, DeadlineItem[]>();
  const give = (userId: string, item: DeadlineItem) => out.set(userId, [...(out.get(userId) ?? []), item]);
  for (const item of items) {
    const ids = new Set(item.assignees.map((a) => index.get(norm(a))).filter((id): id is string => !!id));
    if (!ids.size && item.audience) for (const u of users) if (u.actions?.includes(item.audience)) ids.add(u.id);
    for (const id of ids) give(id, item);
  }
  return out;
}
