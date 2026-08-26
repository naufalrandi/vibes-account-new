import { RoleTemplate, RoleAssignment } from "../../db/models/roleRegister.models";
import type { AuthContext } from "../../lib/scope";

function tView(t: RoleTemplate) {
  return { id: t.id, code: t.code, name: t.name, category: t.category, purpose: t.purpose, workUnits: t.workUnits ?? [], processes: t.processes ?? [], frameworks: t.frameworks ?? [], responsibilities: t.responsibilities ?? [], authorities: t.authorities ?? [], status: t.status, notes: t.notes, createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
function aView(a: RoleAssignment) {
  return { id: a.id, code: a.code, memberId: a.memberId, memberName: a.memberName, roleId: a.roleId, roleName: a.roleName, workUnit: a.workUnit, effectiveDate: a.effectiveDate, responsibilities: a.responsibilities ?? [], authorities: a.authorities ?? [], modified: a.modified, modReason: a.modReason, modSummary: a.modSummary, modifiedBy: a.modifiedBy, modifiedDate: a.modifiedDate, status: a.status, notes: a.notes, createdBy: a.createdBy, createdAt: a.createdAt, updatedAt: a.updatedAt };
}

// ---- Role templates ----
export async function listTemplates(auth: AuthContext) {
  const rows = await RoleTemplate.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(tView);
}

// ---- Assignments ----
export async function listAssignments(auth: AuthContext) {
  const rows = await RoleAssignment.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(aView);
}
