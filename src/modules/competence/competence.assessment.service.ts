import { Op, Model, type ModelStatic } from "sequelize";
import {
  CompetenceRole, CompetenceAssignment, CompetenceAssessment, CompetenceGap,
  CompetenceSkill, CompetenceTraining, CompetenceEducation, User,
} from "../../db/models";
import {
  ROLE_STATUS, ASSESS_STATUS,
  type AssessReqResult, type ProfileItem, type ProfileRequirement,
} from "../../db/models/competence.models";
import type { AuthContext } from "../../lib/scope";
import { resolveCompany } from "../business/business.service";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { assertMayApprove } from "../approvals/approval.service";
import { getCompSettings } from "./competence.service";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../../lib/errors";

const nowIso = () => new Date().toISOString();
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}
async function targetOrg(auth: AuthContext, orgId?: string | null): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}
async function orgWhere(auth: AuthContext, scope?: "enterprise"): Promise<Record<string, unknown>> {
  // Enterprise personnel are the Service Provider's own staff, so an
  // Enterprise-scoped read is the caller's own org — NOT the unrestricted
  // Service-Owner view, which would surface every tenant's records on the
  // Enterprise screens.
  if (scope === "enterprise") return { orgId: auth.orgId };
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}
async function nextCode(model: ModelStatic<Model>, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } } });
  let max = 0;
  for (const r of rows) { const n = Number.parseInt(String(r.get("code")).slice(prefix.length + 1), 10); if (Number.isFinite(n) && n > max) max = n; }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
async function audit(auth: AuthContext, orgId: string, action: string, entityType: string, entityId: string, ip: string | null, metadata?: Record<string, unknown>) {
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, action, entityType, entityId, sourceIp: ip, result: "Success", metadata: metadata ?? null });
}
/** OD `ocLogAdd(record, action, summary, who, now)` equivalent: this codebase
 * has no per-record activity array, so a gap's human-readable activity line
 * (matching OD's exact wording) rides on the system audit log's `metadata`
 * instead of a new column. `activity` carries OD's `action` text verbatim;
 * `detail` carries OD's `summary` argument. */
async function gapActivity(auth: AuthContext, orgId: string, action: string, gapId: string, ip: string | null, activity: string, detail: string) {
  await audit(auth, orgId, action, "CompetenceGap", gapId, ip, { activity, detail });
}
const ocTrunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ============================ ROLES (competence profiles) ============================
// OD `compScopeRoles()`: strict scope match — a tenant only ever sees its own
// roles, Enterprise (`orgId: null`) only ever sees Enterprise's. `scope:
// "enterprise"` is how the Enterprise Roles screen (ServiceOwner-only, RBAC
// already gates the route) asks for just the null-org roles instead of the
// unrestricted cross-tenant view ServiceOwner otherwise gets everywhere else.
export async function listRoles(auth: AuthContext, scope?: "enterprise", company?: string) {
  if (scope === "enterprise") return (await CompetenceRole.findAll({ where: { orgId: null, company: resolveCompany(company) }, order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
  const ids = await visibleTenantOrgIds(auth);
  const where = ids === null ? {} : { orgId: { [Op.in]: ids } };
  return (await CompetenceRole.findAll({ where, order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}
const ROLE_STR = ["name", "description", "reviewFreq", "eduMinLevelId", "eduCountry"] as const;
const ROLE_JSON = ["eduFields", "expReqs", "responsibilities", "authorities"] as const;

/** Validates an optional status field the way `setRoleStatus` does, so the
 * role editor's Status select (OD `rolesEditHtml`, app.html:33785 — the
 * only way to reach "Under review") can be persisted from create/update too,
 * not just the dedicated status-transition endpoint. */
function optionalRoleStatus(input: Record<string, unknown>): string | undefined {
  if (input.status === undefined) return undefined;
  const status = str(input.status);
  if (!status || !ROLE_STATUS.includes(status as never)) throw new BadRequestError(`Invalid role status "${input.status}"`, "INVALID_STATUS");
  return status;
}
export async function createRole(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const isSp = auth.orgType === "ServiceOwner";
  const org = isSp ? null : await targetOrg(auth);
  const name = str(input.name);
  if (!name) throw new BadRequestError("Role name is required", "NAME_REQUIRED");
  // Falls back to the org's `compSettings.defaultReassess` (OD `compSettings()`,
  // index.html:13378) rather than a bare `12` — unchanged for orgs that never
  // touch the setting (its own default is `12`), but now configurable.
  // SP-global roles (org === null) have no per-org settings row, so `12` applies.
  const defaultReassess = org ? (await getCompSettings(org)).defaultReassess : 12;
  const row = await CompetenceRole.create({
    orgId: org, company: resolveCompany(str(input.company) ?? undefined), name, description: str(input.description), status: optionalRoleStatus(input) ?? "Draft",
    reviewFreq: str(input.reviewFreq) || String(defaultReassess), eduMinLevelId: str(input.eduMinLevelId), eduCountry: str(input.eduCountry),
    eduFields: arr(input.eduFields) as string[], expReqs: arr(input.expReqs) as never, responsibilities: arr(input.responsibilities) as never, authorities: arr(input.authorities) as never,
  });
  await audit(auth, org ?? auth.orgId, "competence.role.created", "CompetenceRole", row.id, ip);
  return row.get({ plain: true });
}
async function requireRole(auth: AuthContext, id: string, company?: string): Promise<CompetenceRole> {
  const row = await CompetenceRole.findByPk(id);
  if (!row) throw new NotFoundError("Role not found", "ROLE_NOT_FOUND");
  if (row.orgId !== null) await targetOrg(auth, row.orgId);
  else if (auth.orgType !== "ServiceOwner") throw new ForbiddenError();
  // Enterprise roles are further partitioned per operating company (SOF-265) —
  // a caller acting as one company must not reach into another's role.
  else if (row.company !== resolveCompany(company)) throw new NotFoundError("Role not found", "ROLE_NOT_FOUND");
  return row;
}
export async function updateRole(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null, company?: string) {
  const row = await requireRole(auth, id, company);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of ROLE_STR) if (input[k] !== undefined) rec[k] = str(input[k]);
  for (const k of ROLE_JSON) if (input[k] !== undefined) rec[k] = arr(input[k]);
  const status = optionalRoleStatus(input);
  if (status !== undefined) rec.status = status;
  await row.save();
  await audit(auth, row.orgId ?? auth.orgId, "competence.role.updated", "CompetenceRole", row.id, ip);
  return row.get({ plain: true });
}
export async function setRoleStatus(auth: AuthContext, id: string, status: string, ip: string | null, company?: string) {
  if (!ROLE_STATUS.includes(status as never)) throw new BadRequestError(`Invalid role status "${status}"`, "INVALID_STATUS");
  const row = await requireRole(auth, id, company);
  row.status = status;
  await row.save();
  await audit(auth, row.orgId ?? auth.orgId, "competence.role.status", "CompetenceRole", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteRole(auth: AuthContext, id: string, ip: string | null, company?: string) {
  const row = await requireRole(auth, id, company);
  const org = row.orgId ?? auth.orgId;
  await row.destroy();
  await audit(auth, org, "competence.role.deleted", "CompetenceRole", id, ip);
}

// ============================ ASSIGNMENTS ============================
export async function listAssignments(auth: AuthContext, scope?: "enterprise") {
  return (await CompetenceAssignment.findAll({ where: await orgWhere(auth, scope), order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}
export async function assignRole(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const org = await targetOrg(auth);
  const personId = str(input.personId);
  const roleId = str(input.roleId);
  if (!personId) throw new BadRequestError("Person is required", "PERSON_REQUIRED");
  if (!roleId) throw new BadRequestError("Role is required", "ROLE_REQUIRED");
  await requireRole(auth, roleId);
  const existing = await CompetenceAssignment.findOne({ where: { orgId: org, personId, roleId, status: "Active" } });
  if (existing) return existing.get({ plain: true });
  const row = await CompetenceAssignment.create({
    orgId: org, personId, personName: str(input.personName), roleId,
    assignedDate: str(input.assignedDate) ?? new Date().toISOString().slice(0, 10), status: "Active",
  });
  await audit(auth, org, "competence.assignment.created", "CompetenceAssignment", row.id, ip);
  return row.get({ plain: true });
}
async function requireAssignment(auth: AuthContext, id: string): Promise<CompetenceAssignment> {
  const row = await CompetenceAssignment.findByPk(id);
  if (!row) throw new NotFoundError("Assignment not found", "ASSIGNMENT_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row;
}
export async function setAssignmentStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (status !== "Active" && status !== "Archived") throw new BadRequestError("Invalid assignment status", "INVALID_STATUS");
  const row = await requireAssignment(auth, id);
  row.status = status;
  await row.save();
  await audit(auth, row.orgId, "competence.assignment.status", "CompetenceAssignment", row.id, ip);
  return row.get({ plain: true });
}

// ============================ CHECKLIST BUILDER ============================
function collectComps(items: ProfileItem[]): Map<string, ProfileRequirement> {
  const out = new Map<string, ProfileRequirement>();
  for (const it of items ?? []) {
    for (const c of it.comps ?? []) {
      const key = `${c.kind}:${c.refId}`;
      const prev = out.get(key);
      if (!prev) { out.set(key, { ...c }); continue; }
      // Dedup: strongest necessity + highest level wins, and the TIGHTEST review
      // cadence wins — OD (js/modules.js:722) keeps `f < a[refId].freq`, so a
      // second link with a shorter reviewFreq lowers assessValidUntil. Keeping
      // the first-seen value silently dropped that.
      const prevFreq = Number.parseInt(String(prev.reviewFreq ?? ""), 10);
      const nextFreq = Number.parseInt(String(c.reviewFreq ?? ""), 10);
      const freq = [prevFreq, nextFreq].filter((n) => Number.isFinite(n) && n > 0);
      out.set(key, {
        ...prev,
        necessity: prev.necessity === "Required" || c.necessity === "Required" ? "Required" : "Preferred",
        level: Math.max(prev.level ?? 0, c.level ?? 0) || undefined,
        reviewFreq: freq.length ? String(Math.min(...freq)) : (prev.reviewFreq ?? c.reviewFreq),
      });
    }
  }
  return out;
}

export async function buildChecklist(role: CompetenceRole): Promise<AssessReqResult[]> {
  const skills = new Map((await CompetenceSkill.findAll()).map((s) => [s.id, s]));
  const training = new Map((await CompetenceTraining.findAll()).map((t) => [t.id, t]));
  const reqs: AssessReqResult[] = [];
  const blank = (o: Partial<AssessReqResult>): AssessReqResult => ({
    key: "", kind: "", label: "", necessity: "Required", evalType: "threshold", reqLevel: 0, assessedLevel: 0,
    result: "", methods: [], method: "", reviewFreq: "", evidence: "", reviewNotes: "", attachments: [], ...o,
  });
  // Eligibility rows first (OD js/modules.js:720-721), then the competence
  // groups in the fixed order training -> hard -> soft, each alphabetised by
  // name (:723). The port emitted one insertion-ordered pass, so the three
  // groups interleaved and none was sorted.
  if (role.eduMinLevelId) {
    const edu = await CompetenceEducation.findByPk(role.eduMinLevelId);
    reqs.push(blank({
      key: "edu", kind: "education", refId: role.eduMinLevelId,
      label: `Minimum education — ${edu?.label ?? ""}`, evalType: "threshold",
      methods: ["Record review"], method: "Record review",
    }));
  }
  for (const e of role.expReqs ?? []) {
    // OD skips an experience row that carries neither a sector nor a year count.
    if (!e.sector && !e.years) continue;
    const sector = e.sector ? ` — ${e.sector}` : "";
    const years = e.years ? ` · ≥ ${e.years} year${String(e.years) === "1" ? "" : "s"}` : "";
    reqs.push(blank({
      key: `exp:${e.id}`, kind: "experience", label: `Work experience${sector}${years}`,
      evalType: "threshold", methods: ["Record review"], method: "Record review",
    }));
  }

  const comps = collectComps([...(role.responsibilities ?? []), ...(role.authorities ?? [])]);
  const nameOf = (kind: string, refId: string) =>
    kind === "training" ? training.get(refId)?.name ?? "Training" : skills.get(refId)?.name ?? "Skill";

  for (const kind of ["training", "hard", "soft"] as const) {
    const group = [...comps.values()]
      .filter((c) => c.kind === kind)
      .sort((a, b) => nameOf(kind, a.refId).localeCompare(nameOf(kind, b.refId)));
    for (const c of group) {
      if (kind === "training") {
        reqs.push(blank({
          key: `training:${c.refId}`, kind, refId: c.refId, label: nameOf(kind, c.refId),
          necessity: c.necessity, evalType: "passfail",
          // OD's training line is verified by completion, not by a written exam —
          // "Written exam" additionally surfaced AssessRunner's Launch Exam action
          // on every training row.
          methods: ["Training completion"], method: "Training completion",
          reviewFreq: c.reviewFreq ?? "",
        }));
      } else {
        const s = skills.get(c.refId);
        const methods = s?.methods ?? [];
        reqs.push(blank({
          key: `${kind}:${c.refId}`, kind, refId: c.refId, label: nameOf(kind, c.refId),
          necessity: c.necessity, evalType: "proficiency",
          // OD falls back to 3 for every skill line regardless of necessity.
          reqLevel: c.level || 3,
          methods, method: methods.length === 1 ? methods[0] : "",
          reviewFreq: c.reviewFreq ?? "",
        }));
      }
    }
  }
  return reqs;
}

export async function getChecklist(auth: AuthContext, assignmentId: string): Promise<AssessReqResult[]> {
  const asg = await requireAssignment(auth, assignmentId);
  const role = await CompetenceRole.findByPk(asg.roleId);
  if (!role) throw new NotFoundError("Role not found", "ROLE_NOT_FOUND");
  return buildChecklist(role);
}

// ============================ SCORING ENGINE (exact rules) ============================
type Met = "met" | "partial" | "not" | "na";
export function assessLineMet(r: AssessReqResult): Met {
  if (r.evalType === "proficiency") {
    const as = num(r.assessedLevel), rq = num(r.reqLevel);
    if (as === 0) return "na";
    if (as >= rq) return "met";
    if (as >= rq - 1) return "partial";
    return "not";
  }
  if (r.evalType === "passfail") return r.result === "Passed" ? "met" : r.result === "Failed" ? "not" : "na";
  // threshold (met/not-met)
  return r.result === "Met" ? "met" : r.result === "Not met" ? "not" : "na";
}

export function assessCompute(requirements: AssessReqResult[]): { status: string; score: number; openGaps: number } {
  const required = requirements.filter((r) => r.necessity === "Required");
  let done = 0, partial = 0, fails = 0;
  for (const r of required) {
    const m = assessLineMet(r);
    if (m === "met") done++;
    else if (m === "partial") partial++;
    else fails++; // 'na' and 'not' both count as a fail
  }
  let status: string;
  if (fails > 0) status = "Not yet competent";
  else if (partial > 0) status = "Competent with conditions";
  else if (required.length && done === required.length) status = "Competent";
  else status = "Not yet competent";
  const metAll = requirements.filter((r) => assessLineMet(r) === "met").length;
  const score = requirements.length ? Math.round((metAll / requirements.length) * 100) : 0;
  const openGaps = required.filter((r) => { const m = assessLineMet(r); return m === "not" || m === "partial"; }).length;
  return { status: ASSESS_STATUS.includes(status as never) ? status : "Not yet competent", score, openGaps };
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
/**
 * `defaultMonths` is the org's `compSettings.defaultReassess` (OD
 * `compSettings()`, index.html:13378) — falls back to `12` (the setting's own
 * default value) so existing callers/tests that don't thread it through keep
 * working unchanged.
 */
export function assessValidUntil(dateStr: string, role: CompetenceRole, requirements: AssessReqResult[], defaultMonths = 12): string {
  let months = num(role.reviewFreq) || defaultMonths;
  for (const r of requirements) { if (r.reviewFreq) months = Math.min(months, num(r.reviewFreq) || months); }
  return addMonths(dateStr, months);
}

// ============================ ASSESSMENTS ============================
export async function listAssessments(auth: AuthContext, scope?: "enterprise") {
  return (await CompetenceAssessment.findAll({ where: await orgWhere(auth, scope), order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}
export async function getAssessment(auth: AuthContext, id: string) {
  const row = await CompetenceAssessment.findByPk(id);
  if (!row) throw new NotFoundError("Assessment not found", "ASSESSMENT_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row.get({ plain: true });
}

/** Run/save an assessment: overlays the assessor's answers onto the canonical
 * role checklist, computes status/score/valid-until, and generates gaps. */
export async function createAssessment(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const org = await targetOrg(auth);
  const asg = await CompetenceAssignment.findOne({ where: { id: str(input.assignmentId) ?? "", orgId: org } });
  if (!asg) throw new NotFoundError("Assignment not found", "ASSIGNMENT_NOT_FOUND");
  const role = await CompetenceRole.findByPk(asg.roleId);
  if (!role) throw new NotFoundError("Role not found", "ROLE_NOT_FOUND");
  const date = str(input.date) ?? new Date().toISOString().slice(0, 10);
  const who = await actorName(auth);

  // Re-derive definitions from the role; overlay only the assessor-provided values.
  const base = await buildChecklist(role);
  const byKey = new Map((arr(input.requirements) as Record<string, unknown>[]).map((r) => [String(r.key), r]));
  const merged: AssessReqResult[] = base.map((b) => {
    const c = byKey.get(b.key) ?? {};
    return {
      ...b,
      assessedLevel: num(c.assessedLevel),
      result: typeof c.result === "string" ? c.result : "",
      method: typeof c.method === "string" && c.method ? c.method : b.method,
      evidence: typeof c.evidence === "string" ? c.evidence : "",
      reviewNotes: typeof c.reviewNotes === "string" ? c.reviewNotes : "",
      reviewFreq: typeof c.reviewFreq === "string" && c.reviewFreq ? c.reviewFreq : b.reviewFreq,
      attachments: Array.isArray(c.attachments) ? (c.attachments as never[]) : [],
    };
  });

  const { status, score, openGaps } = assessCompute(merged);
  const { defaultReassess } = await getCompSettings(org);
  const validUntil = assessValidUntil(date, role, merged, defaultReassess);
  const row = await CompetenceAssessment.create({
    orgId: org, code: await nextCode(CompetenceAssessment, "CA"), assignmentId: asg.id, personId: asg.personId, roleId: asg.roleId,
    assessor: str(input.assessor) ?? who, date, notes: str(input.notes), requirements: merged,
    score, openGaps, status, validUntil, approvalState: "Pending",
    activity: [{ ts: nowIso(), user: who, action: "created", summary: `Assessment ${status} (${score}%)` }],
  });
  await generateGaps(org, row, role, merged, date, who);
  // Denormalize latest onto the assignment.
  asg.latestAssessmentId = row.id; asg.latestStatus = status; asg.latestDate = date; asg.validUntil = validUntil;
  await asg.save();
  await audit(auth, org, "competence.assessment.created", "CompetenceAssessment", row.id, ip);
  return row.get({ plain: true });
}

async function generateGaps(org: string, assessment: CompetenceAssessment, _role: CompetenceRole, requirements: AssessReqResult[], date: string, who: string) {
  for (const r of requirements) {
    const met = assessLineMet(r);
    const open = await CompetenceGap.findOne({ where: { assignmentId: assessment.assignmentId, reqKey: r.key, status: { [Op.ne]: "Resolved" } } });
    if (met === "met") {
      if (open) { open.status = "Resolved"; open.resolvedDate = date; open.resolvedBy = who; await open.save(); }
      continue;
    }
    if (r.necessity !== "Required" || (met !== "not" && met !== "partial")) continue;
    if (open) {
      open.currentLevel = num(r.assessedLevel); open.severity = met; open.assessmentId = assessment.id;
      await open.save();
    } else {
      await CompetenceGap.create({
        orgId: org, code: await nextCode(CompetenceGap, "GAP"), assessmentId: assessment.id, assignmentId: assessment.assignmentId,
        personId: assessment.personId, roleId: assessment.roleId, reqKey: r.key, reqLabel: r.label, kind: r.kind, evalType: r.evalType,
        currentLevel: num(r.assessedLevel), requiredLevel: num(r.reqLevel), severity: met, status: "Open", createdDate: date,
      });
    }
  }
}

export async function approveAssessment(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetenceAssessment.findByPk(id);
  if (!row) throw new NotFoundError("Assessment not found", "ASSESSMENT_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  // Competence is a governed module on the Approvals screen, so sign-off has to
  // respect the same pool membership and self-approval rules as the rest —
  // previously this was an unguarded flag flip.
  await assertMayApprove(auth, row.assessor);
  const who = await actorName(auth);
  row.approvalState = "Approved"; row.approvedBy = who; row.approvedDate = new Date().toISOString().slice(0, 10);
  row.activity = [...row.activity, { ts: nowIso(), user: who, action: "approved", summary: "Assessment signed off" }];
  await row.save();
  await audit(auth, row.orgId, "competence.assessment.approved", "CompetenceAssessment", row.id, ip);
  return row.get({ plain: true });
}

/** Reassessment queue: bucket active assignments by validity horizon. */
export async function reassessQueue(auth: AuthContext, scope?: "enterprise") {
  const rows = await CompetenceAssignment.findAll({ where: { ...(await orgWhere(auth, scope)), status: "Active" } });
  const today = new Date().toISOString().slice(0, 10);
  const buckets = { never: [] as unknown[], overdue: [] as unknown[], due: [] as unknown[] };
  for (const a of rows) {
    const v = a.get({ plain: true });
    if (!a.validUntil || !a.latestAssessmentId) { buckets.never.push(v); continue; }
    const days = Math.round((new Date(a.validUntil).getTime() - new Date(today).getTime()) / 86_400_000);
    if (days < 0) buckets.overdue.push(v);
    else if (days <= 60) buckets.due.push(v);
  }
  return buckets;
}

// ============================ GAPS ============================
async function requireGap(auth: AuthContext, id: string): Promise<CompetenceGap> {
  const row = await CompetenceGap.findByPk(id);
  if (!row) throw new NotFoundError("Gap not found", "GAP_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row;
}

/** OD `compGapTpBadge` (index.html:14215), ported onto this backend's single
 * `CompetenceGap` model. OD checks `gap.status==='Closed'` for the terminal
 * "Gap Closed" state; this ported gap vocabulary's terminal state is
 * `'Resolved'` (`GAP_STATUS = ["Open","Reviewed","Planned","Resolved","Waived"]`), so `'Resolved'`
 * is treated as OD's `'Closed'` equivalent here.
 *
 * `linkedPlanStatus` is the linked Training Plan's own `status` (owned by the
 * implementation module) — pass it when known so a plan in
 * 'Pending Reassessment' surfaces as such; omitted/unknown falls through to
 * the generic 'Training Plan Created' bucket, matching OD's final branch. */
export function computeGapDisposition(
  gap: { status: string; noTraining: boolean; trainingPlanId: string | null },
  linkedPlanStatus?: string | null,
): string {
  if (gap.status === "Resolved") return "Gap Closed";
  if (gap.noTraining) return "No Training Required";
  if (!gap.trainingPlanId) return "Training Plan Required";
  if (linkedPlanStatus === "Pending Reassessment") return "Pending Reassessment";
  return "Training Plan Created";
}
function withDisposition<T extends { status: string; noTraining: boolean; trainingPlanId: string | null }>(gap: T): T & { disposition: string } {
  return { ...gap, disposition: computeGapDisposition(gap) };
}

export async function listGaps(auth: AuthContext, scope?: "enterprise") {
  const rows = (await CompetenceGap.findAll({ where: await orgWhere(auth, scope), order: [["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
  return rows.map(withDisposition);
}
export async function updateGap(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireGap(auth, id);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of ["action", "owner", "due", "training"] as const) if (input[k] !== undefined) rec[k] = str(input[k]);
  if (typeof input.trainingDone === "boolean") {
    row.trainingDone = input.trainingDone;
    if (input.trainingDone) { row.trainingDate = str(input.trainingDate) ?? new Date().toISOString().slice(0, 10); if (row.status === "Open") row.status = "Planned"; }
  }
  if (input.status !== undefined) {
    const s = str(input.status) ?? "Open";
    if (["Open", "Reviewed", "Planned", "Resolved"].includes(s)) row.status = s;
  }
  await row.save();
  await audit(auth, row.orgId, "competence.gap.updated", "CompetenceGap", row.id, ip);
  return withDisposition(row.get({ plain: true }));
}

/* ---------------------------------------------------------------------------
 * Gap review lifecycle — OD's "Raised -> Reviewed -> Approved" flow on the
 * Training Plan register ("Review the gap before approving it as a training
 * plan").
 *
 * `reviewedBy`/`reviewedDate` have been columns on this model since it
 * shipped, and the frontend has called all three of these endpoints, but none
 * of them existed: the columns were never written by anything and the calls
 * 404'd against the real API.
 * ------------------------------------------------------------------------- */

/** OD gap review — stamp who reviewed the disposition and when. */
export async function reviewGap(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireGap(auth, id);
  if (row.status === "Resolved") {
    throw new ConflictError("A resolved gap cannot be reviewed — reopen it first", "GAP_RESOLVED");
  }
  if (row.status === "Reviewed") {
    throw new ConflictError("This gap has already been reviewed", "ALREADY_REVIEWED");
  }
  row.status = "Reviewed";
  row.reviewedBy = await actorName(auth);
  row.reviewedDate = new Date().toISOString().slice(0, 10);
  await row.save();
  await audit(auth, row.orgId, "competence.gap.reviewed", "CompetenceGap", row.id, ip);
  return withDisposition(row.get({ plain: true }));
}

/** OD gap un-review — send it back to Raised, clearing the stamp. */
export async function unreviewGap(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireGap(auth, id);
  if (row.status !== "Reviewed") {
    throw new ConflictError("Only a reviewed gap can be returned to raised", "NOT_REVIEWED");
  }
  row.status = "Open";
  row.reviewedBy = null;
  row.reviewedDate = null;
  await row.save();
  await audit(auth, row.orgId, "competence.gap.unreviewed", "CompetenceGap", row.id, ip);
  return withDisposition(row.get({ plain: true }));
}

/**
 * Reopen a closed gap. Clears the resolution stamp AND the "No Training
 * Required" disposition — a gap that is open again has no standing decision
 * that training is unnecessary, so `computeGapDisposition` falls back to
 * "Training Plan Required".
 */
export async function reopenGap(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireGap(auth, id);
  if (row.status === "Open") {
    throw new ConflictError("This gap is already open", "ALREADY_OPEN");
  }
  row.status = "Open";
  row.resolvedBy = null;
  row.resolvedDate = null;
  row.reviewedBy = null;
  row.reviewedDate = null;
  row.noTraining = false;
  row.noTrainingReason = null;
  await row.save();
  await audit(auth, row.orgId, "competence.gap.reopened", "CompetenceGap", row.id, ip);
  return withDisposition(row.get({ plain: true }));
}

/** OD `compGapLinkTraining` (index.html:14217-14221) — bind an EXISTING
 * training plan to the gap. No status transition (unlike the "create a new
 * plan" path below); clears `noTraining` since the gap now has a plan. */
export async function linkGapTrainingPlan(auth: AuthContext, id: string, trainingPlanId: string, ip: string | null) {
  const row = await requireGap(auth, id);
  const tp = str(trainingPlanId);
  if (!tp) throw new BadRequestError("Select a training plan", "TRAINING_PLAN_REQUIRED");
  row.trainingPlanId = tp;
  row.noTraining = false;
  await row.save();
  await gapActivity(auth, row.orgId, "competence.gap.trainingLinked", row.id, ip, "linked a training plan", tp);
  return withDisposition(row.get({ plain: true }));
}

/** OD `compGapNoTraining` (index.html:14222-14226) — justification is
 * mandatory server-side, matching OD's `if(!r){toast('Justification is
 * required');return;}` guard (OD only enforces this client-side). */
export async function markGapNoTrainingRequired(auth: AuthContext, id: string, reason: string, ip: string | null) {
  const row = await requireGap(auth, id);
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new BadRequestError("Justification is required", "REASON_REQUIRED");
  row.noTraining = true;
  row.noTrainingReason = trimmed;
  await row.save();
  await gapActivity(auth, row.orgId, "competence.gap.noTrainingRequired", row.id, ip, "marked no training required", ocTrunc(trimmed, 50));
  return withDisposition(row.get({ plain: true }));
}

/** OD `tpSave` create-path (app.html:25228) — when a NEW training plan is
 * created bound to this gap (source='Competence Gap'), the gap's
 * `trainingPlanId` is set and an Open gap moves to Planned. Exported for the
 * implementation module to call right after it creates the training-plan
 * row — see this task's final report for the exact contract. */
export async function bindGapToNewTrainingPlan(auth: AuthContext, gapId: string, trainingPlanId: string, ip: string | null) {
  const row = await requireGap(auth, gapId);
  row.trainingPlanId = trainingPlanId;
  if (row.status === "Open") row.status = "Planned";
  await row.save();
  await gapActivity(auth, row.orgId, "competence.gap.trainingLinked", row.id, ip, "linked a training plan", trainingPlanId);
  return withDisposition(row.get({ plain: true }));
}

const GAP_REASSESS_MEETS = "Meets Requirement";

/** OD `tpReassessSave` (app.html:25269) — record a reassessment
 * result the linked training plan captured against this gap. "Meets
 * Requirement" resolves the gap; anything else reopens it as Open with the
 * result recorded. Exported for the implementation module's training-plan
 * reassessment flow to call. */
export async function recordGapReassessment(auth: AuthContext, gapId: string, result: string, trainingPlanId: string, ip: string | null) {
  const row = await requireGap(auth, gapId);
  row.reassessResult = result;
  if (result === GAP_REASSESS_MEETS) {
    row.status = "Resolved";
    row.resolvedDate = new Date().toISOString().slice(0, 10);
    row.resolvedBy = trainingPlanId;
    await row.save();
    await gapActivity(auth, row.orgId, "competence.gap.reassessResolved", row.id, ip, "competence gap resolved", "Reassessment met requirement");
  } else {
    row.status = "Open";
    await row.save();
    await gapActivity(auth, row.orgId, "competence.gap.reassessRecorded", row.id, ip, "reassessment recorded", `${result} — gap remains open`);
  }
  return withDisposition(row.get({ plain: true }));
}

/** OD `tpSet(id,'Closed')` (index.html:14090-14091) — when the linked
 * training plan is closed directly (no reassessment result recorded), the
 * bound gap resolves too, but only once (`gp.status!=='Resolved'` guard).
 * Exported for the implementation module's training-plan close flow. */
export async function resolveGapFromTrainingPlanClosed(auth: AuthContext, gapId: string, trainingPlanId: string, ip: string | null) {
  const row = await requireGap(auth, gapId);
  if (row.status === "Resolved") return withDisposition(row.get({ plain: true }));
  row.status = "Resolved";
  row.resolvedDate = new Date().toISOString().slice(0, 10);
  row.resolvedBy = trainingPlanId;
  await row.save();
  await gapActivity(auth, row.orgId, "competence.gap.trainingPlanClosed", row.id, ip, "training plan closed", `Linked training ${trainingPlanId} closed`);
  return withDisposition(row.get({ plain: true }));
}
