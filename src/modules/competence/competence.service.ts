import { Op } from "sequelize";
import { CompetenceEducation, CompetenceRole, CompetenceSkill, CompetenceTraining, CompetenceSettings } from "../../db/models";
import { SKILL_TYPES } from "../../db/models/competence.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { sequelize } from "../../db/sequelize";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { ensureSkillLibrarySeed, ensureTrainingCatalogSeed } from "./competence.skillLibrarySeed";
import { skillTopic } from "../reference/reference.data";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

/** Global (org_id NULL) rows are visible to everyone; tenant rows to their owner. */
async function orgClause(auth: AuthContext): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { [Op.or]: [{ orgId: null }, { orgId: { [Op.in]: ids } }] };
}

// --- Education ladder (ISCED) --------------------------------------------
// OD treats the ISCED ladder as read-only reference data (index.html:17793):
// reads stay global, writes are Service-Owner only.
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Education levels are ISCED reference data managed by the Service Owner");
  }
}
export async function listEducation() {
  return (await CompetenceEducation.findAll({ order: [["level", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createEducation(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth);
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
  assertServiceOwner(auth);
  const row = await CompetenceEducation.findByPk(id);
  if (!row) throw new NotFoundError("Education level not found", "EDU_NOT_FOUND");
  // OD `eduSave` (app.html:34590) writes the ISCED number on update,
  // not just on create — the level is editable on an existing row, not locked
  // after creation.
  if (input.level !== undefined) {
    const level = Number(input.level);
    if (!Number.isInteger(level)) throw new BadRequestError("Level must be an integer", "LEVEL_REQUIRED");
    if (level !== row.level && (await CompetenceEducation.findOne({ where: { level } }))) {
      throw new BadRequestError("That ISCED level already exists", "LEVEL_EXISTS");
    }
    row.level = level;
  }
  if (input.label !== undefined) row.label = str(input.label) ?? row.label;
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await audit(auth, "competence.education.updated", "CompetenceEducation", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteEducation(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const row = await CompetenceEducation.findByPk(id);
  if (!row) throw new NotFoundError("Education level not found", "EDU_NOT_FOUND");
  // OD `eduDel` (app.html:34603): deleting a level falls every role that
  // used it as eligibility back to "no minimum" instead of leaving a dangling
  // id. `CompetenceEducation` is global (org_id NULL, matching OD's shared
  // `db.compEdu`), so — like OD's flat `db.roles` — the cascade is NOT scoped
  // to the deleting admin's org: it clears `eduMinLevelId` on every role that
  // referenced this level, across every org, in the same transaction as the
  // delete so a failure can't half-clear.
  const affectedRoles = await sequelize.transaction(async (transaction) => {
    const [count] = await CompetenceRole.update(
      { eduMinLevelId: null },
      { where: { eduMinLevelId: id }, transaction },
    );
    await row.destroy({ transaction });
    return count;
  });
  await audit(auth, "competence.education.deleted", "CompetenceEducation", id, ip);
  return { affectedRoles };
}

// --- Skill library -------------------------------------------------------
// OD's dual model (global enterprise library + tenant-scoped db.skills):
// SP rows are global (org_id NULL); a tenant's own rows sit beside them.
export async function listSkills(auth: AuthContext, filters: { type?: string } = {}) {
  await ensureSkillLibrarySeed();
  const scope = await orgClause(auth);
  const where = filters.type ? { ...scope, type: filters.type } : scope;
  const rows = (await CompetenceSkill.findAll({ where, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
  // OD `skillTopic(s)` (app.html:34048) pre-computed server-side so the
  // Competence Library grouping (`clibSkills`, 17862) doesn't need a
  // client-side re-implementation of the keyword classifier.
  return rows.map((r) => ({ ...r, topic: skillTopic(r) }));
}
export async function createSkill(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  const type = str(input.type) ?? "hard";
  if (!name) throw new BadRequestError("Skill name is required", "NAME_REQUIRED");
  if (!SKILL_TYPES.includes(type as never)) throw new BadRequestError(`Invalid skill type "${type}"`, "INVALID_TYPE");
  const row = await CompetenceSkill.create({
    orgId: auth.orgType === "ServiceOwner" ? null : auth.orgId,
    name, type, description: str(input.description), methods: arr(input.methods),
  });
  await audit(auth, "competence.skill.created", "CompetenceSkill", row.id, ip);
  return row.get({ plain: true });
}
/** SP may mutate global rows; a tenant only its own (scopeDataset `requireOwned` pattern). */
async function requireOwnedSkill(auth: AuthContext, id: string): Promise<CompetenceSkill> {
  const row = await CompetenceSkill.findByPk(id);
  if (!row) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  const ownGlobal = row.orgId === null && auth.orgType === "ServiceOwner";
  if (!ownGlobal && row.orgId !== auth.orgId) throw new ForbiddenError();
  return row;
}
export async function updateSkill(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireOwnedSkill(auth, id);
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
  const row = await requireOwnedSkill(auth, id);
  await row.destroy();
  await audit(auth, "competence.skill.deleted", "CompetenceSkill", id, ip);
}

// --- Training catalogue ---------------------------------------------------
// SP-global courses (org_id NULL) are visible to everyone; tenant courses are
// visible to (and manageable by) the owning tenant.
export async function listTraining(auth: AuthContext) {
  await ensureTrainingCatalogSeed();
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

// --- Settings singleton (OD `compSettings`, index.html:13378) -------------
// Module governance toggles + the default reassessment cadence. Mirrors
// `awarenessControl.ts`'s `AW_SETTINGS_DEFAULTS`/`getAwSettings`/`setAwSettings`
// (a lazily-initialised per-org JSONB row, org-scoped like every other
// competence read/write here).
//
// `defaultReassess` deliberately stores months (a number) rather than OD's
// `COMP_REVFREQ` string vocabulary — see migration 0048's doc comment. It
// feeds `competence.assessment.service.ts`'s `assessValidUntil`, which used to
// hard-code `12`; `12` stays the *default value* of the setting itself.
export const COMP_SETTINGS_DEFAULTS = {
  requireMethod: true,
  allowActivateMissing: false,
  requireEvidenceMandatory: false,
  allowOverride: true,
  defaultReassess: 12,
};
export type CompSettings = typeof COMP_SETTINGS_DEFAULTS;

/** Per-org settings with OD's defaults for any missing row/key. */
export async function getCompSettings(orgId: string): Promise<CompSettings> {
  const row = await CompetenceSettings.findOne({ where: { orgId } });
  return { ...COMP_SETTINGS_DEFAULTS, ...(row?.settings ?? {}) };
}

export async function setCompSettings(auth: AuthContext, input: Record<string, unknown>, ip: string | null): Promise<CompSettings> {
  const [row] = await CompetenceSettings.findOrCreate({
    where: { orgId: auth.orgId },
    defaults: { orgId: auth.orgId, settings: {} },
  });
  const next: Record<string, boolean | number> = { ...row.settings };
  for (const key of Object.keys(COMP_SETTINGS_DEFAULTS)) {
    const v = input[key];
    if (key === "defaultReassess") {
      if (v === undefined) continue;
      const months = Number(v);
      if (!Number.isInteger(months) || months < 1) throw new BadRequestError("Default reassessment must be a whole number of months", "INVALID_DEFAULT_REASSESS");
      next[key] = months;
    } else if (typeof v === "boolean") {
      next[key] = v;
    }
  }
  row.settings = next;
  await row.save();
  await audit(auth, "competence.settingsUpdated", "CompetenceSettings", row.id, ip);
  return { ...COMP_SETTINGS_DEFAULTS, ...next };
}
