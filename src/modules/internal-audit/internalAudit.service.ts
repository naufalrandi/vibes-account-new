import { Op, Model, type ModelStatic } from "sequelize";
import {
  IaProgram, IaPlan, IaSession, IaFinding, IaReport, IaSettings, User, Role, RoleAssignment,
} from "../../db/models";
import {
  IA_PROG_STATUS, IA_PLAN_STATUS, IA_SESS_STATUS, IA_FIND_TYPES,
  IA_REVIEW_STATUS, IA_ISSUE_STATUS, IA_REPORT_STATUS, IA_REVIEW_DECISIONS,
  type IaActivityEntry, type IaComment,
} from "../../db/models/internalAudit.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { createRecord } from "../implementation/implementation.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

const nowIso = () => new Date().toISOString();

async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}

async function targetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}

async function orgWhere(auth: AuthContext, orgId?: string): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  if (orgId) return { orgId: await targetOrg(auth, orgId) };
  if (ids !== null) return { orgId: { [Op.in]: ids } };
  return {};
}

async function nextCode(model: ModelStatic<Model>, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } } });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(String(r.get("code")).slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function pushActivity(list: IaActivityEntry[], user: string, action: string, summary?: string): IaActivityEntry[] {
  return [...list, { ts: nowIso(), user, action, ...(summary ? { summary } : {}) }];
}

function pushComment(list: IaComment[], user: string, text: string): IaComment[] {
  return [...list, { ts: nowIso(), user, text }];
}

type Commentable = Model & { orgId: string; comments: IaComment[]; lastUpdatedBy: string | null; id: string };

// OD `recComment`: one shared "add a comment" mutation reused by every
// register's detail drawer — here parametrized over the 5 IA models rather
// than duplicated per entity, since the logic is identical.
async function addComment<T extends Commentable>(
  model: ModelStatic<T>, auth: AuthContext, id: string, text: string, ip: string | null,
  notFoundMsg: string, notFoundCode: string, entityType: string, auditAction: string,
): Promise<Record<string, unknown>> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) throw new BadRequestError("Comment text is required", "TEXT_REQUIRED");
  const row = await model.findByPk(id);
  if (!row) throw new NotFoundError(notFoundMsg, notFoundCode);
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  row.comments = pushComment(row.comments, who, trimmed);
  row.lastUpdatedBy = who;
  await row.save();
  await logAudit(auth, row.orgId, auditAction, entityType, row.id, ip);
  return row.get({ plain: true });
}

async function logAudit(auth: AuthContext, orgId: string, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));

// --- Settings ------------------------------------------------------------
export async function getSettings(auth: AuthContext, orgId?: string) {
  const org = await targetOrg(auth, orgId);
  const [row] = await IaSettings.findOrCreate({ where: { orgId: org }, defaults: { orgId: org } });
  return settingsView(row);
}

function settingsView(s: IaSettings) {
  return {
    mandatoryReview: s.mandatoryReview, allowIssueNoReview: s.allowIssueNoReview, allowAdminNC: s.allowAdminNC,
    requireEvidence: s.requireEvidence, requirePIC: s.requirePIC, requireDue: s.requireDue, allowOverride: s.allowOverride,
  };
}

const SETTING_KEYS = ["mandatoryReview", "allowIssueNoReview", "allowAdminNC", "requireEvidence", "requirePIC", "requireDue", "allowOverride"] as const;

export async function updateSettings(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const [row] = await IaSettings.findOrCreate({ where: { orgId: org }, defaults: { orgId: org } });
  for (const k of SETTING_KEYS) {
    if (typeof input[k] === "boolean") (row as unknown as Record<string, unknown>)[k] = input[k];
  }
  // Enabling mandatory review forces off the "issue without review" escape hatch.
  if (row.mandatoryReview) row.allowIssueNoReview = false;
  await row.save();
  await logAudit(auth, org, "ia.settings.updated", "IaSettings", row.id, ip);
  return settingsView(row);
}

async function settingsFor(_auth: AuthContext, org: string) {
  const [row] = await IaSettings.findOrCreate({ where: { orgId: org }, defaults: { orgId: org } });
  return row;
}

// --- Programs ------------------------------------------------------------
export async function listPrograms(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await IaProgram.findAll({ where, order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}

export async function createProgram(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const name = str(input.name);
  const period = str(input.period);
  const processes = arr(input.processes);
  const criteria = arr(input.criteria);
  const leadAuditor = str(input.leadAuditor);
  const auditors = arr(input.auditors);
  if (!name) throw new BadRequestError("Program name is required", "NAME_REQUIRED");
  if (!period) throw new BadRequestError("Audit period is required", "PERIOD_REQUIRED");
  if (processes.length === 0) throw new BadRequestError("Select at least one business process", "PROCESS_REQUIRED");
  if (criteria.length === 0) throw new BadRequestError("Select at least one audit criterion", "CRITERIA_REQUIRED");
  if (!leadAuditor) throw new BadRequestError("Lead auditor is required", "LEAD_REQUIRED");
  if (auditors.length === 0) throw new BadRequestError("Select at least one auditor", "AUDITORS_REQUIRED");
  const who = await actorName(auth);
  const row = await IaProgram.create({
    orgId: org, code: await nextCode(IaProgram, "IAP"), name, period, processes,
    workUnits: arr(input.workUnits), methods: arr(input.methods), criteria,
    scope: str(input.scope), objective: str(input.objective), leadAuditor, auditors,
    independence: str(input.independence) || "Checked", overrideJust: str(input.overrideJust),
    duration: str(input.duration), status: "Draft", notes: str(input.notes),
    createdBy: who, lastUpdatedBy: who, activity: pushActivity([], who, "created", "Program created"),
  });
  await logAudit(auth, org, "ia.program.created", "IaProgram", row.id, ip);
  return row.get({ plain: true });
}

const PROGRAM_FIELDS = ["name", "period", "scope", "objective", "leadAuditor", "independence", "overrideJust", "duration", "notes"] as const;
const PROGRAM_ARRAYS = ["processes", "workUnits", "methods", "criteria", "auditors"] as const;

export async function updateProgram(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await IaProgram.findByPk(id);
  if (!row) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of PROGRAM_FIELDS) if (input[k] !== undefined) rec[k] = str(input[k]);
  for (const k of PROGRAM_ARRAYS) if (input[k] !== undefined) rec[k] = arr(input[k]);
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "updated", "Program updated");
  await row.save();
  await logAudit(auth, row.orgId, "ia.program.updated", "IaProgram", row.id, ip);
  return row.get({ plain: true });
}

export async function setProgramStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!IA_PROG_STATUS.includes(status as never)) throw new BadRequestError(`Invalid program status "${status}"`, "INVALID_STATUS");
  const row = await IaProgram.findByPk(id);
  if (!row) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  if (status === "Approved" && row.status !== "Draft") throw new ConflictError("Only draft programs can be approved", "NOT_DRAFT");
  const who = await actorName(auth);
  row.status = status;
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "status", `Status → ${status}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.program.status", "IaProgram", row.id, ip);
  return row.get({ plain: true });
}

export async function addProgramComment(auth: AuthContext, id: string, text: string, ip: string | null) {
  return addComment(IaProgram, auth, id, text, ip, "Program not found", "PROGRAM_NOT_FOUND", "IaProgram", "ia.program.comment");
}

// --- Plans ---------------------------------------------------------------
export async function listPlans(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await IaPlan.findAll({ where, order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}

export async function createPlan(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const programId = str(input.programId);
  const name = str(input.name);
  if (!programId) throw new BadRequestError("Program is required", "PROGRAM_REQUIRED");
  if (!name) throw new BadRequestError("Plan name is required", "NAME_REQUIRED");
  const program = await IaProgram.findOne({ where: { id: programId, orgId: org } });
  if (!program) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  const who = await actorName(auth);
  const row = await IaPlan.create({
    orgId: org, code: await nextCode(IaPlan, "IAPL"), programId, name,
    processes: input.processes !== undefined ? arr(input.processes) : program.processes,
    criteria: input.criteria !== undefined ? arr(input.criteria) : program.criteria,
    leadAuditor: str(input.leadAuditor) ?? program.leadAuditor, auditors: arr(input.auditors),
    notes: str(input.notes), status: "Draft",
    createdBy: who, lastUpdatedBy: who, activity: pushActivity([], who, "created", "Plan created"),
  });
  await logAudit(auth, org, "ia.plan.created", "IaPlan", row.id, ip);
  return row.get({ plain: true });
}

export async function updatePlan(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await IaPlan.findByPk(id);
  if (!row) throw new NotFoundError("Plan not found", "PLAN_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of ["name", "leadAuditor", "notes"] as const) if (input[k] !== undefined) rec[k] = str(input[k]);
  for (const k of ["processes", "criteria", "auditors"] as const) if (input[k] !== undefined) rec[k] = arr(input[k]);
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "updated", "Plan updated");
  await row.save();
  await logAudit(auth, row.orgId, "ia.plan.updated", "IaPlan", row.id, ip);
  return row.get({ plain: true });
}

export async function setPlanStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!IA_PLAN_STATUS.includes(status as never)) throw new BadRequestError(`Invalid plan status "${status}"`, "INVALID_STATUS");
  const row = await IaPlan.findByPk(id);
  if (!row) throw new NotFoundError("Plan not found", "PLAN_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  row.status = status;
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "status", `Status → ${status}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.plan.status", "IaPlan", row.id, ip);
  return row.get({ plain: true });
}

export async function addPlanComment(auth: AuthContext, id: string, text: string, ip: string | null) {
  return addComment(IaPlan, auth, id, text, ip, "Plan not found", "PLAN_NOT_FOUND", "IaPlan", "ia.plan.comment");
}

// --- Sessions ------------------------------------------------------------
export async function listSessions(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await IaSession.findAll({ where, order: [["date", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createSession(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const planId = str(input.planId);
  const title = str(input.title);
  const date = str(input.date);
  const start = str(input.start);
  const end = str(input.end);
  const process = str(input.process);
  const auditor = str(input.auditor);
  if (!planId) throw new BadRequestError("Plan is required", "PLAN_REQUIRED");
  if (!title) throw new BadRequestError("Session title is required", "TITLE_REQUIRED");
  if (!date) throw new BadRequestError("Session date is required", "DATE_REQUIRED");
  if (!start || !end) throw new BadRequestError("Start and end time are required", "TIME_REQUIRED");
  if (!process) throw new BadRequestError("Business process is required", "PROCESS_REQUIRED");
  if (!auditor) throw new BadRequestError("Auditor is required", "AUDITOR_REQUIRED");
  const plan = await IaPlan.findOne({ where: { id: planId, orgId: org } });
  if (!plan) throw new NotFoundError("Plan not found", "PLAN_NOT_FOUND");
  const who = await actorName(auth);
  const row = await IaSession.create({
    orgId: org, code: await nextCode(IaSession, "IAS"), planId, programId: plan.programId,
    title, date, start, end, tz: str(input.tz) || "Asia/Jakarta", auditor, auditee: str(input.auditee),
    criteria: arr(input.criteria), process, workUnit: str(input.workUnit), methods: arr(input.methods),
    location: str(input.location), link: str(input.link), notes: str(input.notes), status: "Scheduled",
    createdBy: who, lastUpdatedBy: who, activity: pushActivity([], who, "created", "Session scheduled"),
  });
  await logAudit(auth, org, "ia.session.created", "IaSession", row.id, ip);
  return row.get({ plain: true });
}

export async function updateSession(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await IaSession.findByPk(id);
  if (!row) throw new NotFoundError("Session not found", "SESSION_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of ["title", "date", "start", "end", "tz", "auditor", "auditee", "process", "workUnit", "location", "link", "notes"] as const) if (input[k] !== undefined) rec[k] = str(input[k]);
  for (const k of ["criteria", "methods"] as const) if (input[k] !== undefined) rec[k] = arr(input[k]);
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "updated", "Session updated");
  await row.save();
  await logAudit(auth, row.orgId, "ia.session.updated", "IaSession", row.id, ip);
  return row.get({ plain: true });
}

export async function setSessionStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!IA_SESS_STATUS.includes(status as never)) throw new BadRequestError(`Invalid session status "${status}"`, "INVALID_STATUS");
  const row = await IaSession.findByPk(id);
  if (!row) throw new NotFoundError("Session not found", "SESSION_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  row.status = status;
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "status", `Status → ${status}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.session.status", "IaSession", row.id, ip);
  return row.get({ plain: true });
}

export async function addSessionComment(auth: AuthContext, id: string, text: string, ip: string | null) {
  return addComment(IaSession, auth, id, text, ip, "Session not found", "SESSION_NOT_FOUND", "IaSession", "ia.session.comment");
}

// --- Planning mode: move / merge (OD `iaCommitMove`, app.html:23570) ---

/** Org-role assignments that grant Planning Mode (OD `iaCanPlan`, 12159). */
const IA_PLAN_ROLES = ["Top Management", "Quality Manager", "Internal Auditor", "Information Security Officer"] as const;

/** Session statuses that may still be dragged (OD `iaMovableSessions`). */
const MOVABLE_SESS_STATUS = ["Scheduled", "Rescheduled"] as const;

/**
 * OD `iaCanPlan`: planning is allowed for the Administrator role-group or for
 * members holding one of the audit-management org roles in the roles register.
 * Enforced server-side so the FE button gate cannot be bypassed.
 */
async function assertCanPlan(auth: AuthContext, orgId: string): Promise<void> {
  if (auth.isSuperAdmin) return;
  const user = await User.findByPk(auth.userId, { include: [Role] });
  const iamRoles = (user?.get("Roles") as Role[] | undefined) ?? [];
  if (iamRoles.some((r) => r.isSuperAdmin || r.name.toLowerCase().includes("admin"))) return;
  const memberOr: Record<string, unknown>[] = [{ memberId: auth.userId }];
  if (user?.fullName) memberOr.push({ memberName: user.fullName });
  const held = await RoleAssignment.count({
    where: {
      orgId, roleName: { [Op.in]: [...IA_PLAN_ROLES] }, status: { [Op.ne]: "Archived" },
      [Op.or]: memberOr,
    },
  });
  if (held === 0) throw new ForbiddenError("Rescheduling requires audit manager permission", "PLAN_FORBIDDEN");
}

/** OD `iaDurHrs`, in minutes: end − start, floored at 0. */
function sessMinutes(s: { start: string | null; end: string | null }): number {
  if (!s.start || !s.end) return 0;
  const [sh = 0, sm = 0] = s.start.split(":").map((n) => Number.parseInt(n, 10));
  const [eh = 0, em = 0] = s.end.split(":").map((n) => Number.parseInt(n, 10));
  const mins = eh * 60 + em - (sh * 60 + sm);
  return Number.isFinite(mins) && mins > 0 ? mins : 0;
}

/** OD `iaAddMin`: HH:MM plus minutes, clamped to the same day. */
function addMinutes(hhmm: string, mins: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  const total = Math.max(0, Math.min(1439, (h || 0) * 60 + (m || 0) + mins));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface IaSessionMoveInput {
  toPeriod: string;
  toProcess?: string;
  toWorkUnit?: string | null;
  mergeTargetId?: string;
  overrideReason?: string;
}

/**
 * Move (drag-reschedule) a session to another period/process, or merge it into
 * an existing session block in the target cell. Mirrors OD's Planning Mode:
 * locked sessions refuse the move, double-bookings demand an override reason
 * (recorded to the activity log), and a merge sums planned durations and
 * unions criteria/methods. The merged-away source is cancelled — not deleted —
 * so the client-side undo can restore it.
 */
export async function moveSession(auth: AuthContext, id: string, input: IaSessionMoveInput, ip: string | null) {
  const row = await IaSession.findByPk(id);
  if (!row) throw new NotFoundError("Session not found", "SESSION_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  await assertCanPlan(auth, row.orgId);

  const toPeriod = input.toPeriod;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(toPeriod)) throw new BadRequestError("Target period must be YYYY-MM", "INVALID_PERIOD");

  // OD `iaMovableSessions`: started/completed work, open findings or a
  // generated report freeze the schedule.
  if (!(MOVABLE_SESS_STATUS as readonly string[]).includes(row.status)) {
    throw new ConflictError("Completed audit records cannot be rescheduled", "SESSION_LOCKED");
  }
  const openFinds = await IaFinding.count({
    where: { orgId: row.orgId, sessionId: row.id, issueStatus: { [Op.notIn]: ["Closed", "Rejected"] } },
  });
  if (openFinds > 0) throw new ConflictError("Sessions with open findings cannot be rescheduled", "SESSION_LOCKED");
  const orgReports = await IaReport.findAll({ where: { orgId: row.orgId }, attributes: ["sessions"] });
  if (orgReports.some((r) => (r.sessions ?? []).includes(row.code))) {
    throw new ConflictError("Reported audit sessions cannot be rescheduled", "SESSION_LOCKED");
  }

  // Double-booking detection (OD `iaPlanMove`, 12181): the same auditor or
  // auditee already engaged in the target month requires an override reason.
  // `date` is a DATEONLY column, so match the month with a range rather than
  // LIKE (Postgres has no ~~ operator for date).
  const [toY = 0, toM = 0] = toPeriod.split("-").map((n) => Number.parseInt(n, 10));
  const monthStart = `${toPeriod}-01`;
  const monthEnd = new Date(Date.UTC(toY, toM, 1)).toISOString().slice(0, 10);
  const monthPeers = await IaSession.findAll({
    where: { orgId: row.orgId, id: { [Op.ne]: row.id }, status: { [Op.ne]: "Cancelled" }, date: { [Op.gte]: monthStart, [Op.lt]: monthEnd } },
  });
  const conflicts: string[] = [];
  if (row.auditor && monthPeers.some((s) => s.auditor === row.auditor)) {
    conflicts.push(`Auditor ${row.auditor} already has an audit session in ${toPeriod}.`);
  }
  if (row.auditee && monthPeers.some((s) => s.auditee === row.auditee)) {
    conflicts.push(`Auditee ${row.auditee} is already assigned in ${toPeriod}.`);
  }
  const override = typeof input.overrideReason === "string" ? input.overrideReason.trim() : "";
  if (conflicts.length > 0 && !override) {
    throw new ConflictError(`Potential scheduling conflict: ${conflicts.join(" ")}`, "SCHEDULE_CONFLICT");
  }

  const who = await actorName(auth);
  const fromYm = (row.date ?? "").slice(0, 7);
  const fromProcess = row.process;

  if (input.mergeTargetId) {
    const target = await IaSession.findOne({ where: { id: input.mergeTargetId, orgId: row.orgId } });
    if (!target || target.id === row.id) throw new NotFoundError("Merge target session not found", "MERGE_TARGET_NOT_FOUND");
    if ((target.date ?? "").slice(0, 7) !== toPeriod) throw new BadRequestError("Merge target is not in the target period", "MERGE_TARGET_PERIOD");
    // OD merge (12212): durations sum into the target block; criteria and
    // methods union; notes concatenate.
    target.end = addMinutes(target.start || "09:00", sessMinutes(target) + sessMinutes(row));
    target.criteria = [...new Set([...(target.criteria ?? []), ...(row.criteria ?? [])])];
    target.methods = [...new Set([...(target.methods ?? []), ...(row.methods ?? [])])];
    if (row.notes) target.notes = target.notes ? `${target.notes}\n${row.notes}` : row.notes;
    target.lastUpdatedBy = who;
    target.activity = pushActivity(
      target.activity, who, "merged",
      `Merged ${row.code} from ${fromYm}${fromProcess !== target.process ? ` · ${fromProcess}` : ""} — planned duration combined`,
    );
    if (override) target.activity = pushActivity(target.activity, who, "override", `Scheduling conflict override recorded: ${override}`);
    await target.save();
    row.status = "Cancelled";
    row.lastUpdatedBy = who;
    row.activity = pushActivity(row.activity, who, "merged", `Merged into ${target.code}`);
    await row.save();
    await logAudit(auth, row.orgId, "ia.session.merged", "IaSession", target.id, ip);
    return { session: target.get({ plain: true }), merged: true };
  }

  // Plain move: keep the day-of-month, clamped to the target month's length.
  const [y = 0, m = 0] = toPeriod.split("-").map((n) => Number.parseInt(n, 10));
  const monthLen = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number.parseInt((row.date ?? "").slice(8, 10), 10) || 1, monthLen);
  row.date = `${toPeriod}-${String(day).padStart(2, "0")}`;
  const toProcess = typeof input.toProcess === "string" ? input.toProcess.trim() : "";
  const procChanged = toProcess !== "" && toProcess !== row.process;
  if (procChanged) {
    row.process = toProcess;
    if (input.toWorkUnit !== undefined) row.workUnit = str(input.toWorkUnit);
  }
  row.lastUpdatedBy = who;
  row.activity = pushActivity(
    row.activity, who, "rescheduled",
    `Moved ${fromYm} → ${toPeriod}${procChanged ? ` · ${fromProcess} → ${row.process}` : ""}`,
  );
  if (override) row.activity = pushActivity(row.activity, who, "override", `Scheduling conflict override recorded: ${override}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.session.moved", "IaSession", row.id, ip);
  return { session: row.get({ plain: true }), merged: false };
}

// --- Findings ------------------------------------------------------------
export async function listFindings(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await IaFinding.findAll({ where, order: [["updatedAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}

function applyFindingSubmit(row: IaFinding, submit: boolean, mandatoryReview: boolean) {
  if (!submit) { row.reviewStatus = "Not Required"; row.issueStatus = "Draft"; return; }
  if (mandatoryReview) {
    row.reviewRequired = true;
    row.reviewStatus = "Pending Lead Auditor Review";
    row.issueStatus = "Pending Lead Auditor Review";
  } else {
    row.reviewRequired = false;
    row.reviewStatus = "Not Required";
    row.issueStatus = "Ready to Issue";
  }
}

export async function createFinding(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const programId = str(input.programId);
  const title = str(input.title);
  const description = str(input.description);
  const process = str(input.process);
  if (!programId) throw new BadRequestError("Program is required", "PROGRAM_REQUIRED");
  if (!title) throw new BadRequestError("Finding title is required", "TITLE_REQUIRED");
  if (!description) throw new BadRequestError("Finding description is required", "DESC_REQUIRED");
  if (!process) throw new BadRequestError("Business process is required", "PROCESS_REQUIRED");
  const program = await IaProgram.findOne({ where: { id: programId, orgId: org } });
  if (!program) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  const settings = await settingsFor(auth, org);
  const evidence = str(input.evidence);
  if (settings.requireEvidence && !evidence) throw new BadRequestError("Audit evidence is required", "EVIDENCE_REQUIRED");
  const type = str(input.type) ?? "Nonconformity";
  if (!IA_FIND_TYPES.includes(type as never)) throw new BadRequestError(`Invalid finding type "${type}"`, "INVALID_TYPE");
  const submit = input.submit === true;
  const who = await actorName(auth);
  const row = IaFinding.build({
    orgId: org, code: await nextCode(IaFinding, "IAF"), programId,
    planId: str(input.planId), sessionId: str(input.sessionId), title, type, description, evidence,
    frameworks: arr(input.frameworks), criteria: str(input.criteria), process, workUnit: str(input.workUnit),
    auditor: who, pic: str(input.pic), due: str(input.due),
    createdBy: who, lastUpdatedBy: who,
    activity: pushActivity([], who, submit ? "submitted" : "created", submit ? "Finding submitted" : "Finding drafted"),
  });
  applyFindingSubmit(row, submit, settings.mandatoryReview);
  await row.save();
  await logAudit(auth, org, "ia.finding.created", "IaFinding", row.id, ip);
  return row.get({ plain: true });
}

const FINDING_STR_FIELDS = ["title", "description", "evidence", "criteria", "process", "workUnit", "pic", "due"] as const;

export async function updateFinding(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await IaFinding.findByPk(id);
  if (!row) throw new NotFoundError("Finding not found", "FINDING_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const settings = await settingsFor(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of FINDING_STR_FIELDS) if (input[k] !== undefined) rec[k] = str(input[k]);
  if (input.type !== undefined) {
    const type = str(input.type) ?? "Nonconformity";
    if (!IA_FIND_TYPES.includes(type as never)) throw new BadRequestError(`Invalid finding type "${type}"`, "INVALID_TYPE");
    row.type = type;
  }
  if (input.frameworks !== undefined) row.frameworks = arr(input.frameworks);
  const submit = input.submit === true;
  if (submit && settings.requireEvidence && !str(row.evidence)) throw new BadRequestError("Audit evidence is required", "EVIDENCE_REQUIRED");
  const who = await actorName(auth);
  if (submit) applyFindingSubmit(row, true, settings.mandatoryReview);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, submit ? "submitted" : "updated", submit ? "Finding submitted" : "Finding updated");
  await row.save();
  await logAudit(auth, row.orgId, "ia.finding.updated", "IaFinding", row.id, ip);
  return row.get({ plain: true });
}

export async function reviewFinding(auth: AuthContext, id: string, decision: string, extra: Record<string, unknown>, ip: string | null) {
  if (!IA_REVIEW_DECISIONS.includes(decision as never)) throw new BadRequestError(`Invalid review decision "${decision}"`, "INVALID_DECISION");
  const row = await IaFinding.findByPk(id);
  if (!row) throw new NotFoundError("Finding not found", "FINDING_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  if (row.reviewStatus !== "Pending Lead Auditor Review") throw new ConflictError("Finding is not pending review", "NOT_PENDING_REVIEW");
  const rec = row as unknown as Record<string, unknown>;
  for (const k of ["type", "pic", "due"] as const) if (extra[k] !== undefined) rec[k] = str(extra[k]);
  if (extra.reviewNotes !== undefined) row.reviewNotes = str(extra.reviewNotes);
  row.reviewDecision = decision;
  if (decision === "Approve Finding") { row.reviewStatus = "Approved"; row.issueStatus = "Ready to Issue"; }
  else if (decision === "Request Revision") { row.reviewStatus = "Revision Requested"; row.issueStatus = "Revision Requested"; }
  else { row.reviewStatus = "Rejected"; row.issueStatus = "Rejected"; }
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "reviewed", `${decision}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.finding.reviewed", "IaFinding", row.id, ip);
  return row.get({ plain: true });
}

export async function issueFinding(auth: AuthContext, id: string, ip: string | null) {
  const row = await IaFinding.findByPk(id);
  if (!row) throw new NotFoundError("Finding not found", "FINDING_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const settings = await settingsFor(auth, row.orgId);
  const canIssue = row.issueStatus === "Ready to Issue" || (!settings.mandatoryReview && row.issueStatus === "Draft");
  if (!canIssue) throw new ConflictError("Finding is not ready to issue", "NOT_READY");
  if (settings.requirePIC && !str(row.pic)) throw new BadRequestError("A PIC is required before issuing", "PIC_REQUIRED");
  if (settings.requireDue && !str(row.due)) throw new BadRequestError("A due date is required before issuing", "DUE_REQUIRED");
  const who = await actorName(auth);
  row.issueStatus = "Issued";
  row.issuedTo = row.pic;
  row.issuedDate = nowIso();
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "issued", "Finding issued to PIC");
  await row.save();
  await logAudit(auth, row.orgId, "ia.finding.issued", "IaFinding", row.id, ip);
  return row.get({ plain: true });
}

/** Route an issued finding to a Nonconformity or Improvement register record. */
export async function routeFinding(auth: AuthContext, id: string, target: "nc" | "imp", ip: string | null) {
  const row = await IaFinding.findByPk(id);
  if (!row) throw new NotFoundError("Finding not found", "FINDING_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  if (target === "nc") {
    if (row.type !== "Nonconformity") throw new BadRequestError("Only nonconformity findings route to an NC", "NOT_NC_TYPE");
    if (row.linkedNC) throw new ConflictError(`Already linked to ${row.linkedNC}`, "ALREADY_LINKED");
    // OD `iafRoute` (app.html:24039) carries the finding's process,
    // work unit, PIC, due date and framework relevance across to the NC it
    // creates — routing used to drop all of that context.
    const nc = await createRecord(auth, "nonconformities", {
      title: row.title,
      frameworks: row.frameworks ?? [],
      data: {
        category: "Audit Finding", sourceFindingId: row.code, description: row.description,
        source: `Internal audit ${row.code}`, process: row.process ?? "", workUnit: row.workUnit ?? "",
        pic: row.pic ?? "", due: row.due ?? "",
      },
    }, row.orgId, ip);
    row.linkedNC = nc.code;
  } else {
    if (row.type !== "Observation" && row.type !== "Opportunity for Improvement") throw new BadRequestError("Only observations / OFIs route to an improvement", "NOT_IMP_TYPE");
    if (row.linkedImp) throw new ConflictError(`Already linked to ${row.linkedImp}`, "ALREADY_LINKED");
    // OD's improvement carries the same context, plus `evidence` (owner is the
    // finding's PIC, matching OD `owner:f.pic`).
    const imp = await createRecord(auth, "improvements", {
      title: row.title,
      owner: row.pic ?? null,
      frameworks: row.frameworks ?? [],
      data: {
        category: "Process Improvement", priority: "Medium", sourceFindingId: row.code, benefit: row.description,
        process: row.process ?? "", workUnit: row.workUnit ?? "", due: row.due ?? "", evidence: row.evidence ?? "",
      },
    }, row.orgId, ip);
    row.linkedImp = imp.code;
  }
  row.issueStatus = "Follow-up Created";
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "routed", target === "nc" ? `Routed to ${row.linkedNC}` : `Routed to ${row.linkedImp}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.finding.routed", "IaFinding", row.id, ip);
  return row.get({ plain: true });
}

export async function addFindingComment(auth: AuthContext, id: string, text: string, ip: string | null) {
  return addComment(IaFinding, auth, id, text, ip, "Finding not found", "FINDING_NOT_FOUND", "IaFinding", "ia.finding.comment");
}

// --- Reports -------------------------------------------------------------
export async function listReports(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await IaReport.findAll({ where, order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}

export async function generateReport(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const programId = str(input.programId);
  if (!programId) throw new BadRequestError("Program is required", "PROGRAM_REQUIRED");
  const program = await IaProgram.findOne({ where: { id: programId, orgId: org } });
  if (!program) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  const plans = await IaPlan.findAll({ where: { orgId: org, programId }, attributes: ["code"] });
  const sessions = await IaSession.findAll({ where: { orgId: org, programId }, attributes: ["code"] });
  const findings = await IaFinding.findAll({ where: { orgId: org, programId }, attributes: ["code"] });
  const who = await actorName(auth);
  const now = nowIso();
  const row = await IaReport.create({
    orgId: org, code: await nextCode(IaReport, "IAR"), programId, period: program.period,
    plans: plans.map((p) => p.code), sessions: sessions.map((s) => s.code), findings: findings.map((f) => f.code),
    evidenceSummary: input.evidenceSummary !== false, followupIncluded: input.followupIncluded !== false,
    summary: str(input.summary), conclusion: str(input.conclusion) ?? "The management system was found to be effectively implemented and maintained, with the findings noted above addressed through the follow-up process.",
    preparedBy: who, approvedBy: str(input.approvedBy), reportDate: now, status: "Generated",
    createdBy: who, lastUpdatedBy: who, activity: pushActivity([], who, "generated", "Report generated"),
  });
  // Program auto-promotes to "Report Generated" once a report exists.
  if (program.status === "Completed" || program.status === "In Progress") {
    program.status = "Report Generated";
    await program.save();
  }
  await logAudit(auth, org, "ia.report.generated", "IaReport", row.id, ip);
  return row.get({ plain: true });
}

/**
 * OD `iarSave(id)` (index.html:12669) — the report form is create-OR-edit. In edit
 * mode OD reassigns every generated field from the form, re-derives the plan /
 * session / finding code lists from the (possibly changed) program, logs
 * "edited the report" and toasts "Report saved". Unlike generate, editing never
 * re-stamps the code, preparedBy, reportDate or status, and never re-promotes the
 * program — OD only does that on the create branch.
 */
export async function updateReport(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await IaReport.findByPk(id);
  if (!row) throw new NotFoundError("Report not found", "REPORT_NOT_FOUND");
  const org = await targetOrg(auth, row.orgId);
  const programId = str(input.programId) ?? row.programId;
  const program = await IaProgram.findOne({ where: { id: programId, orgId: org } });
  if (!program) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
  const [plans, sessions, findings] = await Promise.all([
    IaPlan.findAll({ where: { orgId: org, programId }, attributes: ["code"] }),
    IaSession.findAll({ where: { orgId: org, programId }, attributes: ["code"] }),
    IaFinding.findAll({ where: { orgId: org, programId }, attributes: ["code"] }),
  ]);
  const who = await actorName(auth);
  row.programId = programId;
  row.period = program.period;
  row.plans = plans.map((p) => p.code);
  row.sessions = sessions.map((s) => s.code);
  row.findings = findings.map((f) => f.code);
  if (input.evidenceSummary !== undefined) row.evidenceSummary = input.evidenceSummary !== false;
  if (input.followupIncluded !== undefined) row.followupIncluded = input.followupIncluded !== false;
  if (input.summary !== undefined) row.summary = str(input.summary);
  if (input.conclusion !== undefined) row.conclusion = str(input.conclusion);
  if (input.approvedBy !== undefined) row.approvedBy = str(input.approvedBy);
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "edited the report", "Report updated");
  await row.save();
  await logAudit(auth, org, "ia.report.updated", "IaReport", row.id, ip);
  return row.get({ plain: true });
}

export async function setReportStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!IA_REPORT_STATUS.includes(status as never)) throw new BadRequestError(`Invalid report status "${status}"`, "INVALID_STATUS");
  const row = await IaReport.findByPk(id);
  if (!row) throw new NotFoundError("Report not found", "REPORT_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  row.status = status;
  row.lastUpdatedBy = who;
  row.activity = pushActivity(row.activity, who, "status", `Status → ${status}`);
  await row.save();
  await logAudit(auth, row.orgId, "ia.report.status", "IaReport", row.id, ip);
  return row.get({ plain: true });
}

export async function addReportComment(auth: AuthContext, id: string, text: string, ip: string | null) {
  return addComment(IaReport, auth, id, text, ip, "Report not found", "REPORT_NOT_FOUND", "IaReport", "ia.report.comment");
}

export const CATALOG = { IA_PROG_STATUS, IA_PLAN_STATUS, IA_SESS_STATUS, IA_ISSUE_STATUS, IA_REVIEW_STATUS };
