import { RoleTemplate, RoleAssignment } from "../../db/models/roleRegister.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export const RT_CATEGORIES = ["Governance", "Management System", "Process", "Audit", "Risk", "Compliance", "Information Security", "Privacy", "HR", "Operations", "IT", "Other"] as const;
export const RT_STATUSES = ["Draft", "Active", "Inactive", "Archived"] as const;
export const RA_STATUSES = ["Draft", "Active", "Modified", "Inactive", "Archived"] as const;

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export interface TemplateInput {
  name?: string; category?: string; purpose?: string | null;
  workUnits?: string[]; processes?: string[]; frameworks?: string[];
  responsibilities?: string[]; authorities?: string[]; status?: string; notes?: string | null;
}
export interface AssignInput {
  memberId?: string; memberName?: string; roleId?: string; workUnit?: string | null; effectiveDate?: string | null;
  responsibilities?: string[]; authorities?: string[]; status?: string; notes?: string | null; modReason?: string | null;
}

function tView(t: RoleTemplate) {
  return { id: t.id, code: t.code, name: t.name, category: t.category, purpose: t.purpose, workUnits: t.workUnits ?? [], processes: t.processes ?? [], frameworks: t.frameworks ?? [], responsibilities: t.responsibilities ?? [], authorities: t.authorities ?? [], status: t.status, notes: t.notes, createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
function aView(a: RoleAssignment) {
  return { id: a.id, code: a.code, memberId: a.memberId, memberName: a.memberName, roleId: a.roleId, roleName: a.roleName, workUnit: a.workUnit, effectiveDate: a.effectiveDate, responsibilities: a.responsibilities ?? [], authorities: a.authorities ?? [], modified: a.modified, modReason: a.modReason, modSummary: a.modSummary, modifiedBy: a.modifiedBy, modifiedDate: a.modifiedDate, status: a.status, notes: a.notes, createdBy: a.createdBy, createdAt: a.createdAt, updatedAt: a.updatedAt };
}

/** OD rtDiff: which entries were added/removed vs the template. */
function diff(template: string[], assigned: string[]): { added: string[]; removed: string[] } {
  const t = new Set(template), a = new Set(assigned);
  return { added: assigned.filter((x) => !t.has(x)), removed: template.filter((x) => !a.has(x)) };
}

function computeCode(rows: { code: string }[], prefix: string): string {
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
async function nextTemplateCode(orgId: string): Promise<string> {
  return computeCode(await RoleTemplate.findAll({ where: { orgId }, attributes: ["code"] }), "ROL");
}
async function nextAssignmentCode(orgId: string): Promise<string> {
  return computeCode(await RoleAssignment.findAll({ where: { orgId }, attributes: ["code"] }), "RA");
}

// ---- Role templates ----
export async function listTemplates(auth: AuthContext) {
  const rows = await RoleTemplate.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(tView);
}

async function requireTemplate(auth: AuthContext, id: string): Promise<RoleTemplate> {
  const t = await RoleTemplate.findOne({ where: { id, orgId: auth.orgId } });
  if (!t) throw new NotFoundError("Role template does not exist", "ROLE_TEMPLATE_NOT_FOUND");
  return t;
}

export async function createTemplate(auth: AuthContext, input: TemplateInput, ip: string | null) {
  if (!input.name || !input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const category = input.category || "Other";
  if (!RT_CATEGORIES.includes(category as (typeof RT_CATEGORIES)[number])) throw new BadRequestError("Invalid category", "INVALID_CATEGORY");
  const status = input.status || "Draft";
  if (!RT_STATUSES.includes(status as (typeof RT_STATUSES)[number])) throw new BadRequestError("Invalid status", "INVALID_STATUS");
  const t = await RoleTemplate.create({
    orgId: auth.orgId, code: await nextTemplateCode(auth.orgId), name: input.name.trim(), category, purpose: input.purpose ?? null,
    workUnits: arr(input.workUnits), processes: arr(input.processes), frameworks: arr(input.frameworks),
    responsibilities: arr(input.responsibilities), authorities: arr(input.authorities), status, notes: input.notes ?? null, createdBy: auth.userId ?? null,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleTemplate.created", entityType: "RoleTemplate", entityId: t.id, sourceIp: ip, result: "Success" });
  return tView(t);
}

export async function updateTemplate(auth: AuthContext, id: string, input: TemplateInput, ip: string | null) {
  const t = await requireTemplate(auth, id);
  if (input.name !== undefined) { if (!input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED"); t.name = input.name.trim(); }
  if (input.category !== undefined) { if (!RT_CATEGORIES.includes(input.category as (typeof RT_CATEGORIES)[number])) throw new BadRequestError("Invalid category", "INVALID_CATEGORY"); t.category = input.category; }
  if (input.status !== undefined) { if (!RT_STATUSES.includes(input.status as (typeof RT_STATUSES)[number])) throw new BadRequestError("Invalid status", "INVALID_STATUS"); t.status = input.status; }
  if (input.purpose !== undefined) t.purpose = input.purpose;
  if (input.workUnits !== undefined) t.workUnits = arr(input.workUnits);
  if (input.processes !== undefined) t.processes = arr(input.processes);
  if (input.frameworks !== undefined) t.frameworks = arr(input.frameworks);
  if (input.responsibilities !== undefined) t.responsibilities = arr(input.responsibilities);
  if (input.authorities !== undefined) t.authorities = arr(input.authorities);
  if (input.notes !== undefined) t.notes = input.notes;
  await t.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleTemplate.updated", entityType: "RoleTemplate", entityId: t.id, sourceIp: ip, result: "Success" });
  return tView(t);
}

export async function archiveTemplate(auth: AuthContext, id: string, ip: string | null) {
  const t = await requireTemplate(auth, id);
  t.status = "Archived";
  await t.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleTemplate.archived", entityType: "RoleTemplate", entityId: t.id, sourceIp: ip, result: "Success" });
  return tView(t);
}

// ---- Assignments ----
export async function listAssignments(auth: AuthContext) {
  const rows = await RoleAssignment.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(aView);
}

async function requireAssignment(auth: AuthContext, id: string): Promise<RoleAssignment> {
  const a = await RoleAssignment.findOne({ where: { id, orgId: auth.orgId } });
  if (!a) throw new NotFoundError("Assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  return a;
}

/** Assign a template to a member — responsibilities/authorities are seeded from the template. */
export async function assignRole(auth: AuthContext, input: AssignInput, ip: string | null) {
  if (!input.memberId || !input.memberName) throw new BadRequestError("Member is required", "MEMBER_REQUIRED");
  if (!input.roleId) throw new BadRequestError("Role is required", "ROLE_REQUIRED");
  const t = await requireTemplate(auth, input.roleId);
  const a = await RoleAssignment.create({
    orgId: auth.orgId, code: await nextAssignmentCode(auth.orgId),
    memberId: input.memberId, memberName: input.memberName, roleId: t.id, roleName: t.name,
    workUnit: input.workUnit ?? null, effectiveDate: input.effectiveDate ?? null,
    responsibilities: input.responsibilities !== undefined ? arr(input.responsibilities) : (t.responsibilities ?? []),
    authorities: input.authorities !== undefined ? arr(input.authorities) : (t.authorities ?? []),
    modified: false, modReason: null, modSummary: null, modifiedBy: null, modifiedDate: null,
    status: input.status || "Active", notes: input.notes ?? null, createdBy: auth.userId ?? null,
  });
  await recomputeModified(a, t, auth.userId ?? null, input.modReason ?? null);
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleAssignment.created", entityType: "RoleAssignment", entityId: a.id, sourceIp: ip, result: "Success" });
  return aView(a);
}

/** Recompute the Modified flag/summary from the template diff (OD rtDiff). */
async function recomputeModified(a: RoleAssignment, t: RoleTemplate, actor: string | null, reason: string | null): Promise<void> {
  const rd = diff(t.responsibilities ?? [], a.responsibilities ?? []);
  const ad = diff(t.authorities ?? [], a.authorities ?? []);
  const changed = rd.added.length > 0 || rd.removed.length > 0 || ad.added.length > 0 || ad.removed.length > 0;
  a.modified = changed;
  if (changed) {
    a.modSummary = `Responsibilities +${rd.added.length}/-${rd.removed.length}; Authorities +${ad.added.length}/-${ad.removed.length}`;
    a.modifiedBy = actor;
    a.modifiedDate = new Date().toISOString();
    if (reason) a.modReason = reason;
    if (a.status === "Active") a.status = "Modified";
  } else {
    a.modSummary = null; a.modReason = null; a.modifiedBy = null; a.modifiedDate = null;
    if (a.status === "Modified") a.status = "Active";
  }
}

export async function updateAssignment(auth: AuthContext, id: string, input: AssignInput, ip: string | null) {
  const a = await requireAssignment(auth, id);
  const t = await RoleTemplate.findOne({ where: { id: a.roleId, orgId: auth.orgId } });
  if (input.workUnit !== undefined) a.workUnit = input.workUnit;
  if (input.effectiveDate !== undefined) a.effectiveDate = input.effectiveDate;
  if (input.responsibilities !== undefined) a.responsibilities = arr(input.responsibilities);
  if (input.authorities !== undefined) a.authorities = arr(input.authorities);
  if (input.notes !== undefined) a.notes = input.notes;
  if (input.status !== undefined) {
    if (!RA_STATUSES.includes(input.status as (typeof RA_STATUSES)[number])) throw new BadRequestError("Invalid status", "INVALID_STATUS");
    a.status = input.status;
  }
  if (t) await recomputeModified(a, t, auth.userId ?? null, input.modReason ?? null);
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleAssignment.updated", entityType: "RoleAssignment", entityId: a.id, sourceIp: ip, result: "Success" });
  return aView(a);
}

export async function archiveAssignment(auth: AuthContext, id: string, ip: string | null) {
  const a = await requireAssignment(auth, id);
  a.status = "Archived";
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "roleAssignment.archived", entityType: "RoleAssignment", entityId: a.id, sourceIp: ip, result: "Success" });
  return aView(a);
}
