import { randomUUID } from "crypto";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import {
  ReferenceSectorFramework, ReferenceIndustrySector, ReferenceEducationField, ReferenceEducationLevel, ReferenceCountry,
} from "../../db/models/referenceDb.models";
import { ISIC, NACE, KBLI, ISCEDF, type HierNode } from "../reference/reference.data";
import { COUNTRY_SEED } from "./data/countrySeed";
import { EDUCATION_LEVEL_SEED } from "./data/educationLevelSeed";

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

async function ensureCountriesSeeded(orgId: string): Promise<void> {
  if (await ReferenceCountry.count({ where: { orgId } })) return;
  const naceFrameworkId = await ensureSectorFrameworksSeeded(orgId);
  const kbliLevels = KBLI.map(nodeToFrameworkLevel);
  await ReferenceCountry.bulkCreate(COUNTRY_SEED.map((c) => ({
    orgId, code: c.code, name: c.name, currency: c.currency, language: c.language, capital: null,
    eduFramework: null, sectorFramework: null,
    sectorFrameworkRef: EU_MEMBERS.includes(c.code) ? naceFrameworkId : null,
    // OD special-case: Indonesia auto-seeds the full KBLI tree as its own sector levels.
    sectorLevels: c.code === "ID" ? kbliLevels : [],
    regions: [], eduLevels: [], edited: false,
  })));
}

async function logAudit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// --- Education Levels --------------------------------------------------------
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
  await row.destroy();
  await logAudit(auth, "referencedb.edulevel.deleted", "ReferenceEducationLevel", id, ip);
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
  await row.destroy();
  await logAudit(auth, "referencedb.sector.deleted", "ReferenceIndustrySector", id, ip);
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
  await row.destroy();
  await logAudit(auth, "referencedb.edufield.deleted", "ReferenceEducationField", id, ip);
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
