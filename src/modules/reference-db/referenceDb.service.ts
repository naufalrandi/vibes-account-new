import { randomUUID } from "crypto";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { sequelize } from "../../db/sequelize";
import { CompetenceRole } from "../../db/models/competence.models";
import {
  ReferenceSectorFramework, ReferenceIndustrySector, ReferenceEducationField, ReferenceEducationLevel, ReferenceCountry,
  ReferenceBank, ReferenceHoliday, ReferenceBpProcess, ReferenceFiscalConfig, type FiscalPeriodRow,
} from "../../db/models/referenceDb.models";
import { ISIC, NACE, KBLI, ISCEDF, type HierNode } from "../reference/reference.data";
import { COUNTRY_SEED } from "./data/countrySeed";
import { COUNTRY_REGION_SEED } from "./data/countryRegionSeed";
import { EDUCATION_LEVEL_SEED } from "./data/educationLevelSeed";
import { EDU_FRAMEWORK_SEED } from "./data/eduFrameworkSeed";

/**
 * Enterprise "Database" reference registers (OD `ent-db-*`). Each org gets
 * its own editable copy, lazily seeded on first read from the immutable
 * ISIC/NACE/KBLI/ISCED-F datasets `/v1/reference` already serves, matching
 * OD's single-mutable-copy-per-instance model (`isicSeedList`/`efSeedList`).
 */

// OD `index.html:16778` — the 27 EU member states auto-reference the shared
// NACE Rev.2 framework instead of copying a tree into every country.
const EU_MEMBERS = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

function nodeToFrameworkLevel(n: HierNode) {
  return { code: n.code, label: n.label, lv: n.level, parent: n.parent, isic: n.isic ?? null };
}

/** Resolves each node's string `parent` code to the freshly-generated row id
 * for its parent, so the whole tree can be seeded in one bulk insert. */
function withResolvedParents(orgId: string, nodes: HierNode[]): { id: string; orgId: string; code: string; label: string; level: number; parentId: string | null }[] {
  const codeToId = new Map<string, string>();
  const rows = nodes.map((n) => {
    const id = randomUUID();
    codeToId.set(n.code, id);
    return { id, orgId, code: n.code, label: n.label, level: n.level, parentId: null as string | null };
  });
  nodes.forEach((n, i) => { if (n.parent) rows[i].parentId = codeToId.get(n.parent) ?? null; });
  return rows;
}

async function ensureIndustrySectorsSeeded(orgId: string): Promise<void> {
  if (await ReferenceIndustrySector.count({ where: { orgId } })) return;
  await ReferenceIndustrySector.bulkCreate(withResolvedParents(orgId, ISIC).map((r) => ({ ...r, description: null })));
}

async function ensureEducationFieldsSeeded(orgId: string): Promise<void> {
  if (await ReferenceEducationField.count({ where: { orgId } })) return;
  await ReferenceEducationField.bulkCreate(withResolvedParents(orgId, ISCEDF));
}

async function ensureEducationLevelsSeeded(orgId: string): Promise<void> {
  if (await ReferenceEducationLevel.count({ where: { orgId } })) return;
  await ReferenceEducationLevel.bulkCreate(EDUCATION_LEVEL_SEED.map((l) => ({ orgId, ...l })));
}

/** Returns the id of the (possibly just-seeded) shared "NACE Rev.2" framework. */
async function ensureSectorFrameworksSeeded(orgId: string): Promise<string> {
  const existing = await ReferenceSectorFramework.findOne({ where: { orgId, name: "NACE Rev.2" } });
  if (existing) return existing.id;
  const row = await ReferenceSectorFramework.create({
    orgId, name: "NACE Rev.2", region: "European Union", levels: NACE.map(nodeToFrameworkLevel),
  });
  return row.id;
}

// OD `index.html:16786-16804` — national education-qualification frameworks
// (ID KKNI, AU AQF, GB RQF, MY MQF, IE NFQ, SG SGUS, ZA NQF) mapped to ISCED
// 2011, seeded per country so the role-editor's national-equivalence feature
// has data to work with.
const EDU_FRAMEWORK_BY_COUNTRY = new Map(EDU_FRAMEWORK_SEED.map((f) => [f.code, f]));

async function ensureCountriesSeeded(orgId: string): Promise<void> {
  if (await ReferenceCountry.count({ where: { orgId } })) return;
  const naceFrameworkId = await ensureSectorFrameworksSeeded(orgId);
  const kbliLevels = KBLI.map(nodeToFrameworkLevel);
  await ReferenceCountry.bulkCreate(COUNTRY_SEED.map((c) => {
    const eduSeed = EDU_FRAMEWORK_BY_COUNTRY.get(c.code);
    return {
      orgId, code: c.code, name: c.name, currency: c.currency, language: c.language, capital: null,
      eduFramework: eduSeed?.framework ?? null, sectorFramework: null,
      sectorFrameworkRef: EU_MEMBERS.includes(c.code) ? naceFrameworkId : null,
      // OD special-case: Indonesia auto-seeds the full KBLI tree as its own sector levels.
      sectorLevels: c.code === "ID" ? kbliLevels : [],
      // OD `COUNTRY_REGIONS` (+ `_REST`) — countries OD has no region data
      // for stay empty, exactly as they are there.
      regions: COUNTRY_REGION_SEED[c.code] ?? [],
      eduLevels: eduSeed ? eduSeed.levels.map((l) => ({ level: l.isced, code: l.code, label: l.label, isced: String(l.isced) })) : [],
      edited: false,
    };
  }));
}

async function logAudit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// --- Education Levels [DEPRECATED / ORPHANED] --------------------------------
// `ReferenceEducationLevel` has no consumer besides its own CRUD below. OD
// keeps a single `db.compEdu` store shared by the Enterprise admin page, the
// role editor, and the Competence Library. This port originally split that
// into two stores keyed differently: this org-scoped `ReferenceEducationLevel`
// table (below) for the Enterprise page, and the global `CompetenceEducation`
// table (`competence.service.ts`, `competence_education`) for the role editor
// and Competence Library. As of the reference-db/competence unification, the
// Enterprise "Education Levels" page (`EducationLevelsPage.tsx`) has been
// repointed at `CompetenceEducation` via `/v1/competence/education`
// (`listCompEducation`/`createCompEducation`/`updateCompEducation`/
// `deleteCompEducation`) — the same store roles actually reference — so this
// table and its `/v1/reference-db/education-levels` endpoints below are now
// dead weight: nothing reads or writes them, and `deleteEducationLevel`'s
// cascade can never fire since no `CompetenceRole.eduMinLevelId` was ever set
// to one of *these* rows' ids.
//
// Left in place deliberately (not dropped): a migration for this table is
// potentially in flight elsewhere and dropping it here would race with that.
// Follow-up: once no other in-flight work depends on it, remove
// `ReferenceEducationLevel` (model, migration, seed, these 4 functions, the
// 4 controller actions, and the 4 routes in `referenceDb.routes.ts`).
export async function listEducationLevels(auth: AuthContext) {
  await ensureEducationLevelsSeeded(auth.orgId);
  return (await ReferenceEducationLevel.findAll({ where: { orgId: auth.orgId }, order: [["level", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createEducationLevel(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const level = Number(input.level);
  const label = str(input.label);
  if (!Number.isInteger(level) || level < 0 || level > 8) throw new BadRequestError("Level must be an integer 0-8", "LEVEL_INVALID");
  if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
  const row = await ReferenceEducationLevel.create({ orgId: auth.orgId, level, label, description: str(input.description) });
  await logAudit(auth, "referencedb.edulevel.created", "ReferenceEducationLevel", row.id, ip);
  return row.get({ plain: true });
}
export async function updateEducationLevel(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceEducationLevel.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Education level not found", "LEVEL_NOT_FOUND");
  // OD `eduSave` (app.html:34590) writes level on update, not just create —
  // this previously silently dropped it, so editing the ISCED number never persisted.
  if (input.level !== undefined) {
    const level = Number(input.level);
    if (!Number.isInteger(level) || level < 0 || level > 8) throw new BadRequestError("Level must be an integer 0-8", "LEVEL_INVALID");
    row.level = level;
  }
  if (input.label !== undefined) {
    const label = str(input.label);
    if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
    row.label = label;
  }
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await logAudit(auth, "referencedb.edulevel.updated", "ReferenceEducationLevel", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteEducationLevel(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceEducationLevel.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Education level not found", "LEVEL_NOT_FOUND");
  // OD `eduDel` (app.html:34603): deleting a level falls every role that used
  // it as eligibility back to "no minimum" instead of leaving a dangling id —
  // done in the same transaction as the delete so a failure can't half-clear.
  const affectedRoles = await sequelize.transaction(async (transaction) => {
    const [count] = await CompetenceRole.update(
      { eduMinLevelId: null },
      { where: { orgId: auth.orgId, eduMinLevelId: id }, transaction },
    );
    await row.destroy({ transaction });
    return count;
  });
  await logAudit(auth, "referencedb.edulevel.deleted", "ReferenceEducationLevel", id, ip);
  return { affectedRoles };
}

// --- Industry Sectors (ISIC tree) --------------------------------------------
export async function listIndustrySectors(auth: AuthContext) {
  await ensureIndustrySectorsSeeded(auth.orgId);
  return (await ReferenceIndustrySector.findAll({ where: { orgId: auth.orgId }, order: [["code", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createIndustrySector(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const code = str(input.code);
  const label = str(input.label);
  if (!code) throw new BadRequestError("Code is required", "CODE_REQUIRED");
  if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
  const parentId = str(input.parentId);
  const parent = parentId ? await ReferenceIndustrySector.findOne({ where: { id: parentId, orgId: auth.orgId } }) : null;
  const level = parent ? parent.level + 1 : 1;
  const row = await ReferenceIndustrySector.create({ orgId: auth.orgId, code, label, level, parentId: parent?.id ?? null, description: str(input.description) });
  await logAudit(auth, "referencedb.sector.created", "ReferenceIndustrySector", row.id, ip);
  return row.get({ plain: true });
}
export async function updateIndustrySector(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceIndustrySector.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Industry sector not found", "SECTOR_NOT_FOUND");
  if (input.label !== undefined) {
    const label = str(input.label);
    if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
    row.label = label;
  }
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await logAudit(auth, "referencedb.sector.updated", "ReferenceIndustrySector", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteIndustrySector(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceIndustrySector.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Industry sector not found", "SECTOR_NOT_FOUND");
  // OD `sectorDel` (app.html:34692): deleting a sector clears every role's
  // `expReqs[].sector` entries that pointed at it instead of leaving a dangling
  // reference — `expReqs` is JSONB so each matching role is rewritten
  // individually, all inside the delete's transaction.
  //
  // Matched by `code`, not `id`: OD keeps a single `db.sectors` store, so a
  // role's `expReqs[].sector` and the sector's own id are the same value.
  // This port seeds `ReferenceIndustrySector` per-org from the same ISIC
  // dataset `/v1/reference` serves (`ensureIndustrySectorsSeeded` above), and
  // the role editor's "Industrial sector" picker persists that static-dataset
  // `code` (e.g. "A", "01"), not this row's own UUID `id` — so the cascade has
  // to compare against `row.code` to ever match. `code` is stable and unique
  // within an org's seeded tree, so this is lossless and behaviourally
  // identical to OD's single-store id match.
  const affectedRoles = await sequelize.transaction(async (transaction) => {
    const roles = await CompetenceRole.findAll({ where: { orgId: auth.orgId }, transaction });
    let count = 0;
    for (const role of roles) {
      const reqs = role.expReqs ?? [];
      if (!reqs.some((r) => r.sector === row.code)) continue;
      role.expReqs = reqs.map((r) => (r.sector === row.code ? { ...r, sector: "" } : r));
      await role.save({ transaction });
      count += 1;
    }
    await row.destroy({ transaction });
    return count;
  });
  await logAudit(auth, "referencedb.sector.deleted", "ReferenceIndustrySector", id, ip);
  return { affectedRoles };
}

// --- Fields of Education (ISCED-F tree, + platform "Extension" tier) --------
export async function listEducationFields(auth: AuthContext) {
  await ensureEducationFieldsSeeded(auth.orgId);
  return (await ReferenceEducationField.findAll({ where: { orgId: auth.orgId }, order: [["code", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createEducationField(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const label = str(input.label);
  if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
  const parentId = str(input.parentId);
  const parent = parentId ? await ReferenceEducationField.findOne({ where: { id: parentId, orgId: auth.orgId } }) : null;
  // OD `efExtModal`: extensions are always layered on top of a Narrow (level 2) field, coded EXT.<parent>.<n>.
  let code = str(input.code);
  let level = parent ? parent.level + 1 : 1;
  if (!code) {
    if (!parent) throw new BadRequestError("A parent field is required for extensions", "PARENT_REQUIRED");
    const siblings = await ReferenceEducationField.count({ where: { parentId: parent.id } });
    code = `EXT.${parent.code}.${siblings + 1}`;
    level = 4;
  }
  const row = await ReferenceEducationField.create({ orgId: auth.orgId, code, label, level, parentId: parent?.id ?? null });
  await logAudit(auth, "referencedb.edufield.created", "ReferenceEducationField", row.id, ip);
  return row.get({ plain: true });
}
export async function updateEducationField(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceEducationField.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Field of education not found", "FIELD_NOT_FOUND");
  if (input.label !== undefined) {
    const label = str(input.label);
    if (!label) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
    row.label = label;
  }
  await row.save();
  await logAudit(auth, "referencedb.edufield.updated", "ReferenceEducationField", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteEducationField(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceEducationField.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Field of education not found", "FIELD_NOT_FOUND");
  // Deliberately improves on OD rather than porting it literally: OD's
  // `efDel`/`efUseCount` (index.html:18560/18511) check the LEGACY SINGULAR
  // `r.eduField`, which is `''` in every OD seed — the field this port (and
  // OD's own role editor, `efToggleField`) actually writes to is the PLURAL
  // `r.eduFields[]` array. OD's cascade is therefore vestigial dead code in
  // the prototype; we cascade against the live plural array instead.
  //
  // Matched by `code`, not `id`: like sectors above, `ReferenceEducationField`
  // is seeded per-org from the same ISCED-F dataset `/v1/reference` serves
  // (`ensureEducationFieldsSeeded`), and the role editor's "Field of study"
  // checklist persists that static-dataset `code`, not this row's own UUID
  // `id` — `eduFields` is a JSONB array, so each matching role is rewritten
  // individually, all inside the delete's transaction.
  const affectedRoles = await sequelize.transaction(async (transaction) => {
    const roles = await CompetenceRole.findAll({ where: { orgId: auth.orgId }, transaction });
    let count = 0;
    for (const role of roles) {
      const fields = role.eduFields ?? [];
      if (!fields.includes(row.code)) continue;
      role.eduFields = fields.filter((f) => f !== row.code);
      await role.save({ transaction });
      count += 1;
    }
    await row.destroy({ transaction });
    return count;
  });
  await logAudit(auth, "referencedb.edufield.deleted", "ReferenceEducationField", id, ip);
  return { affectedRoles };
}

// --- Sector Frameworks (shared national/regional classification catalogs) ---
export async function listSectorFrameworks(auth: AuthContext) {
  await ensureSectorFrameworksSeeded(auth.orgId);
  return (await ReferenceSectorFramework.findAll({ where: { orgId: auth.orgId }, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createSectorFramework(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const row = await ReferenceSectorFramework.create({ orgId: auth.orgId, name, region: str(input.region), levels: [] });
  await logAudit(auth, "referencedb.sectorframework.created", "ReferenceSectorFramework", row.id, ip);
  return row.get({ plain: true });
}
export async function updateSectorFramework(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceSectorFramework.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Sector framework not found", "FRAMEWORK_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.region !== undefined) row.region = str(input.region);
  if (Array.isArray(input.levels)) row.levels = input.levels as ReferenceSectorFramework["levels"];
  await row.save();
  await logAudit(auth, "referencedb.sectorframework.updated", "ReferenceSectorFramework", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteSectorFramework(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceSectorFramework.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Sector framework not found", "FRAMEWORK_NOT_FOUND");
  await row.destroy();
  // OD: deleting a framework falls the referencing countries back to "custom" (no framework).
  await ReferenceCountry.update({ sectorFrameworkRef: null }, { where: { orgId: auth.orgId, sectorFrameworkRef: id } });
  await logAudit(auth, "referencedb.sectorframework.deleted", "ReferenceSectorFramework", id, ip);
}

// --- Countries ----------------------------------------------------------------
const COUNTRY_FIELDS = ["name", "currency", "language", "capital", "eduFramework", "sectorFramework", "sectorFrameworkRef"] as const;
const COUNTRY_ARRAYS = ["regions", "eduLevels", "sectorLevels"] as const;

export async function listCountries(auth: AuthContext) {
  await ensureCountriesSeeded(auth.orgId);
  return (await ReferenceCountry.findAll({ where: { orgId: auth.orgId }, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createCountry(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const code = str(input.code)?.toUpperCase();
  const name = str(input.name);
  if (!code) throw new BadRequestError("ISO code is required", "CODE_REQUIRED");
  if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  if (await ReferenceCountry.findOne({ where: { orgId: auth.orgId, code } })) throw new BadRequestError("A country with this code already exists", "CODE_TAKEN");
  const row = await ReferenceCountry.create({
    orgId: auth.orgId, code, name, currency: str(input.currency), language: str(input.language), capital: str(input.capital),
    eduFramework: str(input.eduFramework), sectorFramework: str(input.sectorFramework), sectorFrameworkRef: str(input.sectorFrameworkRef),
    regions: [], eduLevels: [], sectorLevels: [], edited: true,
  });
  await logAudit(auth, "referencedb.country.created", "ReferenceCountry", row.id, ip);
  return row.get({ plain: true });
}
export async function updateCountry(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceCountry.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Country not found", "COUNTRY_NOT_FOUND");
  const rec = row as unknown as Record<string, unknown>;
  for (const k of COUNTRY_FIELDS) if (input[k] !== undefined) rec[k] = str(input[k]);
  for (const k of COUNTRY_ARRAYS) if (Array.isArray(input[k])) rec[k] = input[k];
  row.edited = true;
  await row.save();
  await logAudit(auth, "referencedb.country.updated", "ReferenceCountry", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteCountry(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceCountry.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Country not found", "COUNTRY_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "referencedb.country.deleted", "ReferenceCountry", id, ip);
}

/* ===========================================================================
 * Banks / Holidays / Business Processes / Fiscal Periods
 *
 * The four Enterprise → Database screens whose endpoints the frontend has
 * always called and this module never implemented. Same org-scoped CRUD shape
 * as the tables above.
 * ======================================================================== */

const BANK_TYPES = ["Commercial", "State", "Digital", "Islamic"];
const HOLIDAY_TYPES = ["Public", "Religious", "Company"];
const BP_STATUSES = ["Active", "Inactive", "Archived"];

function pick(value: unknown, allowed: string[], fallback: string): string {
  const v = str(value);
  return v && allowed.includes(v) ? v : fallback;
}

// ---- Banks ----------------------------------------------------------------
export async function listBanks(auth: AuthContext) {
  return (await ReferenceBank.findAll({ where: { orgId: auth.orgId }, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createBank(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  if (!name) throw new BadRequestError("Bank name is required", "NAME_REQUIRED");
  const row = await ReferenceBank.create({
    orgId: auth.orgId, name,
    country: str(input.country) ?? "", countryName: str(input.countryName) ?? "",
    code: str(input.code) ?? "", swift: str(input.swift) ?? "",
    type: pick(input.type, BANK_TYPES, "Commercial"),
  });
  await logAudit(auth, "referencedb.bank.created", "ReferenceBank", row.id, ip);
  return row.get({ plain: true });
}
export async function updateBank(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceBank.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Bank not found", "BANK_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Bank name is required", "NAME_REQUIRED");
    row.name = name;
  }
  for (const k of ["country", "countryName", "code", "swift"] as const) {
    if (input[k] !== undefined) row[k] = str(input[k]) ?? "";
  }
  if (input.type !== undefined) row.type = pick(input.type, BANK_TYPES, row.type);
  await row.save();
  await logAudit(auth, "referencedb.bank.updated", "ReferenceBank", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteBank(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceBank.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Bank not found", "BANK_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "referencedb.bank.deleted", "ReferenceBank", id, ip);
  return { id };
}

// ---- Holidays -------------------------------------------------------------
export async function listHolidays(auth: AuthContext) {
  return (await ReferenceHoliday.findAll({ where: { orgId: auth.orgId }, order: [["date", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createHoliday(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  const date = str(input.date);
  if (!name) throw new BadRequestError("Holiday name is required", "NAME_REQUIRED");
  if (!date) throw new BadRequestError("Holiday date is required", "DATE_REQUIRED");
  const row = await ReferenceHoliday.create({
    orgId: auth.orgId, name, date,
    country: str(input.country) ?? "", countryName: str(input.countryName) ?? "",
    type: pick(input.type, HOLIDAY_TYPES, "Public"),
    dayOff: input.dayOff === undefined ? true : !!input.dayOff,
  });
  await logAudit(auth, "referencedb.holiday.created", "ReferenceHoliday", row.id, ip);
  return row.get({ plain: true });
}
export async function updateHoliday(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceHoliday.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Holiday not found", "HOLIDAY_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Holiday name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.date !== undefined) {
    const date = str(input.date);
    if (!date) throw new BadRequestError("Holiday date is required", "DATE_REQUIRED");
    row.date = date;
  }
  for (const k of ["country", "countryName"] as const) if (input[k] !== undefined) row[k] = str(input[k]) ?? "";
  if (input.type !== undefined) row.type = pick(input.type, HOLIDAY_TYPES, row.type);
  if (input.dayOff !== undefined) row.dayOff = !!input.dayOff;
  await row.save();
  await logAudit(auth, "referencedb.holiday.updated", "ReferenceHoliday", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteHoliday(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceHoliday.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Holiday not found", "HOLIDAY_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "referencedb.holiday.deleted", "ReferenceHoliday", id, ip);
  return { id };
}

// ---- Business process catalog ---------------------------------------------
export async function listBpProcesses(auth: AuthContext) {
  return (await ReferenceBpProcess.findAll({
    where: { orgId: auth.orgId }, order: [["group", "ASC"], ["subgroup", "ASC"], ["name", "ASC"]],
  })).map((r) => r.get({ plain: true }));
}
export async function createBpProcess(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  const group = str(input.group);
  if (!name) throw new BadRequestError("Process name is required", "NAME_REQUIRED");
  if (!group) throw new BadRequestError("Process group is required", "GROUP_REQUIRED");
  const subgroup = str(input.subgroup) || "General";
  // OD `bpCatalogSave`: a process is unique within its group / sub-group.
  const dup = await ReferenceBpProcess.findOne({ where: { orgId: auth.orgId, group, subgroup, name } });
  if (dup) throw new ConflictError("That process already exists in this group / sub-group", "PROCESS_EXISTS");
  const row = await ReferenceBpProcess.create({
    orgId: auth.orgId, group, subgroup, name,
    desc: str(input.desc) ?? "", status: pick(input.status, BP_STATUSES, "Active"),
  });
  await logAudit(auth, "referencedb.bpprocess.created", "ReferenceBpProcess", row.id, ip);
  return row.get({ plain: true });
}
export async function updateBpProcess(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ReferenceBpProcess.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Business process not found", "PROCESS_NOT_FOUND");
  const group = input.group !== undefined ? str(input.group) || row.group : row.group;
  const subgroup = input.subgroup !== undefined ? str(input.subgroup) || "General" : row.subgroup;
  const name = input.name !== undefined ? str(input.name) : row.name;
  if (!name) throw new BadRequestError("Process name is required", "NAME_REQUIRED");
  const dup = await ReferenceBpProcess.findOne({ where: { orgId: auth.orgId, group, subgroup, name } });
  if (dup && dup.id !== row.id) throw new ConflictError("That process already exists in this group / sub-group", "PROCESS_EXISTS");
  row.group = group; row.subgroup = subgroup; row.name = name;
  if (input.desc !== undefined) row.desc = str(input.desc) ?? "";
  if (input.status !== undefined) row.status = pick(input.status, BP_STATUSES, row.status);
  await row.save();
  await logAudit(auth, "referencedb.bpprocess.updated", "ReferenceBpProcess", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteBpProcess(auth: AuthContext, id: string, ip: string | null) {
  const row = await ReferenceBpProcess.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Business process not found", "PROCESS_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "referencedb.bpprocess.deleted", "ReferenceBpProcess", id, ip);
  return { id };
}

// ---- Fiscal periods -------------------------------------------------------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Generate the period rows for a fiscal year — 12 monthly or 4 quarterly. */
function buildPeriods(fy: string, startMonth: number, periodType: string): FiscalPeriodRow[] {
  const year = Number(fy) || new Date().getFullYear();
  const count = periodType === "Quarterly" ? 4 : 12;
  const step = periodType === "Quarterly" ? 3 : 1;
  const rows: FiscalPeriodRow[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (startMonth - 1) + i * step;
    const y = year + Math.floor(offset / 12);
    const m = offset % 12;
    const endOffset = offset + step - 1;
    const ey = year + Math.floor(endOffset / 12);
    const em = endOffset % 12;
    const last = new Date(Date.UTC(ey, em + 1, 0)).getUTCDate();
    rows.push({
      id: `${fy}-P${i + 1}`,
      name: periodType === "Quarterly" ? `Q${i + 1} ${y}` : `${MONTHS[m]} ${y}`,
      start: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      end: `${ey}-${String(em + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
      status: "Open",
    });
  }
  return rows;
}

/** Lazily create the org's fiscal config on first read, like the other reference tables. */
export async function getFiscalConfig(auth: AuthContext) {
  const existing = await ReferenceFiscalConfig.findOne({ where: { orgId: auth.orgId } });
  if (existing) return existing.get({ plain: true });
  const fy = String(new Date().getFullYear());
  const row = await ReferenceFiscalConfig.create({
    orgId: auth.orgId, fy, startMonth: 1, periodType: "Monthly", periods: buildPeriods(fy, 1, "Monthly"),
  });
  return row.get({ plain: true });
}

export async function updateFiscalConfig(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  await getFiscalConfig(auth);
  const row = (await ReferenceFiscalConfig.findOne({ where: { orgId: auth.orgId } }))!;
  const fy = input.fy !== undefined ? str(input.fy) || row.fy : row.fy;
  const startMonth = input.startMonth !== undefined ? Number(input.startMonth) : row.startMonth;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new BadRequestError("Start month must be 1-12", "START_MONTH_INVALID");
  }
  const periodType = input.periodType !== undefined ? pick(input.periodType, ["Monthly", "Quarterly"], row.periodType) : row.periodType;
  // Any of the three changing re-derives the periods; per-period status is
  // reset with them, since the old rows no longer describe the same spans.
  const changed = fy !== row.fy || startMonth !== row.startMonth || periodType !== row.periodType;
  row.fy = fy; row.startMonth = startMonth; row.periodType = periodType;
  if (changed) row.periods = buildPeriods(fy, startMonth, periodType);
  await row.save();
  await logAudit(auth, "referencedb.fiscal.updated", "ReferenceFiscalConfig", row.id, ip);
  return row.get({ plain: true });
}

/** OD's per-period Open/Closed toggle. */
export async function setFiscalPeriodStatus(auth: AuthContext, periodId: string, status: string, ip: string | null) {
  if (status !== "Open" && status !== "Closed") {
    throw new BadRequestError("Status must be Open or Closed", "STATUS_INVALID");
  }
  await getFiscalConfig(auth);
  const row = (await ReferenceFiscalConfig.findOne({ where: { orgId: auth.orgId } }))!;
  const periods = row.periods ?? [];
  const target = periods.find((p) => p.id === periodId);
  if (!target) throw new NotFoundError("Fiscal period not found", "PERIOD_NOT_FOUND");
  row.periods = periods.map((p) => (p.id === periodId ? { ...p, status } : p));
  await row.save();
  await logAudit(auth, "referencedb.fiscalperiod.statusSet", "ReferenceFiscalConfig", row.id, ip);
  return row.get({ plain: true });
}
