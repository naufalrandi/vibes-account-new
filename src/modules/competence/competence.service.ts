import { Op } from "sequelize";
import { CompetenceEducation, CompetenceSkill, CompetenceTraining } from "../../db/models";
import { SKILL_TYPES } from "../../db/models/competence.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

// --- Education ladder (ISCED) --------------------------------------------
export async function listEducation() {
  return (await CompetenceEducation.findAll({ order: [["level", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createEducation(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const label = str(input.label);
  const level = Number(input.level);
  if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
  if (!Number.isInteger(level)) throw new BadRequestError("Level must be an integer", "LEVEL_REQUIRED");
  if (await CompetenceEducation.findOne({ where: { level } })) throw new BadRequestError("That ISCED level already exists", "LEVEL_EXISTS");
  const row = await CompetenceEducation.create({ level, label, description: str(input.description) });
  await audit(auth, "competence.education.created", "CompetenceEducation", row.id, ip);
  return row.get({ plain: true });
}
export async function updateEducation(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetenceEducation.findByPk(id);
  if (!row) throw new NotFoundError("Education level not found", "EDU_NOT_FOUND");
  if (input.label !== undefined) row.label = str(input.label) ?? row.label;
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await audit(auth, "competence.education.updated", "CompetenceEducation", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteEducation(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetenceEducation.findByPk(id);
  if (!row) throw new NotFoundError("Education level not found", "EDU_NOT_FOUND");
  await row.destroy();
  await audit(auth, "competence.education.deleted", "CompetenceEducation", id, ip);
}

// --- Skill library -------------------------------------------------------
export async function listSkills(filters: { type?: string } = {}) {
  const where = filters.type ? { type: filters.type } : {};
  return (await CompetenceSkill.findAll({ where, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createSkill(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  const type = str(input.type) ?? "hard";
  if (!name) throw new BadRequestError("Skill name is required", "NAME_REQUIRED");
  if (!SKILL_TYPES.includes(type as never)) throw new BadRequestError(`Invalid skill type "${type}"`, "INVALID_TYPE");
  const row = await CompetenceSkill.create({ name, type, description: str(input.description), methods: arr(input.methods) });
  await audit(auth, "competence.skill.created", "CompetenceSkill", row.id, ip);
  return row.get({ plain: true });
}
export async function updateSkill(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetenceSkill.findByPk(id);
  if (!row) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.type !== undefined) {
    const type = str(input.type) ?? "hard";
    if (!SKILL_TYPES.includes(type as never)) throw new BadRequestError(`Invalid skill type "${type}"`, "INVALID_TYPE");
    row.type = type;
  }
  if (input.description !== undefined) row.description = str(input.description);
  if (input.methods !== undefined) row.methods = arr(input.methods);
  await row.save();
  await audit(auth, "competence.skill.updated", "CompetenceSkill", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteSkill(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetenceSkill.findByPk(id);
  if (!row) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  await row.destroy();
  await audit(auth, "competence.skill.deleted", "CompetenceSkill", id, ip);
}

// --- Training catalogue ---------------------------------------------------
// SP-global courses (org_id NULL) are visible to everyone; tenant courses are
// visible to (and manageable by) the owning tenant.
export async function listTraining(auth: AuthContext) {
  const ids = await visibleTenantOrgIds(auth);
  const orgClause = ids === null ? {} : { [Op.or]: [{ orgId: null }, { orgId: { [Op.in]: ids } }] };
  return (await CompetenceTraining.findAll({ where: orgClause, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createTraining(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  if (!name) throw new BadRequestError("Training name is required", "NAME_REQUIRED");
  const isSp = auth.orgType === "ServiceOwner";
  const row = await CompetenceTraining.create({
    orgId: isSp ? null : auth.orgId, name, source: isSp ? "SP" : "Tenant", description: str(input.description),
  });
  await audit(auth, "competence.training.created", "CompetenceTraining", row.id, ip);
  return row.get({ plain: true });
}
function assertCanManageTraining(auth: AuthContext, row: CompetenceTraining) {
  const ownGlobal = row.orgId === null && auth.orgType === "ServiceOwner";
  if (!ownGlobal && row.orgId !== auth.orgId) throw new ForbiddenError();
}
export async function updateTraining(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetenceTraining.findByPk(id);
  if (!row) throw new NotFoundError("Training not found", "TRAINING_NOT_FOUND");
  assertCanManageTraining(auth, row);
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await audit(auth, "competence.training.updated", "CompetenceTraining", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteTraining(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetenceTraining.findByPk(id);
  if (!row) throw new NotFoundError("Training not found", "TRAINING_NOT_FOUND");
  assertCanManageTraining(auth, row);
  await row.destroy();
  await audit(auth, "competence.training.deleted", "CompetenceTraining", id, ip);
}
