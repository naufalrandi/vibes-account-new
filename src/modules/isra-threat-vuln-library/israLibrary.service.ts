import { Op } from "sequelize";
import {
  IsraAnnexAControl,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraKmSaThreat,
  IsraKmThreatVuln,
  IsraKmVulnControl,
  IsraKmMeta,
  IsraTreatTemplate,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";

/**
 * ISRA + SoA (F-2b) — global reference-library reads + platform-curation
 * writes for the Annex A master, Threat/Vuln libraries, the V2 knowledge
 * maps, the Vuln→Annex A map, the KM publish-state singleton, and the
 * generic RTP treatment templates. See `docs/isra-schema-design.md` §2.3.
 *
 * These are GLOBAL tables (no org_id) — read is open to any authenticated
 * caller (same posture as Framework/Requirement catalog reads); platform
 * curation writes require `isra.library.manage`, which is Service-Owner-only
 * (see `tenantGrants.ts` SP_ONLY_ACTIONS). Org-level customization
 * (overrides, custom controls, suppress/add overlay, maturity baselines)
 * lives in `israOrgControl.service.ts` — a different, org-scoped table group.
 *
 * The Group→Subgroup taxonomy (`isra_sa_groups`/`isra_sa_subgroups`) that the
 * V2 knowledge-map rows reference is F-2a's territory — this module only
 * reads `subgroupId`/`groupId` off the KM rows, it never queries or mutates
 * the taxonomy tables themselves.
 */

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null): Promise<void> {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

// ---------------------------------------------------------------- Annex A --

export async function listAnnexAControls(category?: string) {
  const where = category ? { category } : {};
  const rows = await IsraAnnexAControl.findAll({ where, order: [["ref", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function getAnnexAControl(ref: string) {
  const row = await IsraAnnexAControl.findByPk(ref);
  if (!row) throw new NotFoundError("Annex A control not found", "ANNEXA_NOT_FOUND");
  return row.get({ plain: true });
}

const ANNEXA_FIELDS = ["name", "category", "csf", "type", "fnP", "fnD", "fnC", "dedL", "dedC", "description"] as const;
export interface AnnexAControlInput {
  name?: string;
  category?: string | null;
  csf?: string | null;
  type?: string | null;
  fnP?: boolean;
  fnD?: boolean;
  fnC?: boolean;
  dedL?: boolean;
  dedC?: boolean;
  description?: string | null;
}

export async function updateAnnexAControl(auth: AuthContext, ref: string, input: AnnexAControlInput, ip: string | null) {
  const row = await IsraAnnexAControl.findByPk(ref);
  if (!row) throw new NotFoundError("Annex A control not found", "ANNEXA_NOT_FOUND");
  for (const k of ANNEXA_FIELDS) if (input[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = input[k];
  await row.save();
  await audit(auth, "isra.annexA.updated", "IsraAnnexAControl", ref, ip);
  return row.get({ plain: true });
}

// ---------------------------------------------------------------- Threats --

function nextSeqId(existingIds: string[], prefix: string): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^[A-Z]+-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export async function listThreats(params: { category?: string; status?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.category) where.category = params.category;
  if (params.status) where.status = params.status;
  const rows = await IsraThreatLibrary.findAll({ where, order: [["name", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function getThreat(id: string) {
  const row = await IsraThreatLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Threat not found", "THREAT_NOT_FOUND");
  return row.get({ plain: true });
}

export interface ThreatInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  status?: string;
}

export async function createThreat(auth: AuthContext, input: ThreatInput, ip: string | null) {
  const name = (input.name ?? "").trim();
  if (!name) throw new BadRequestError("Threat name is required", "NAME_REQUIRED");
  const existing = await IsraThreatLibrary.findAll({ attributes: ["id"] });
  const id = nextSeqId(existing.map((r) => r.id), "THR");
  const row = await IsraThreatLibrary.create({ id, name, category: input.category ?? null, description: input.description ?? null, status: input.status ?? "Active" });
  await audit(auth, "isra.threat.created", "IsraThreatLibrary", id, ip);
  return row.get({ plain: true });
}

export async function updateThreat(auth: AuthContext, id: string, input: ThreatInput, ip: string | null) {
  const row = await IsraThreatLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Threat not found", "THREAT_NOT_FOUND");
  if (input.name !== undefined) row.name = input.name;
  if (input.category !== undefined) row.category = input.category;
  if (input.description !== undefined) row.description = input.description;
  if (input.status !== undefined) row.status = input.status;
  await row.save();
  await audit(auth, "isra.threat.updated", "IsraThreatLibrary", id, ip);
  return row.get({ plain: true });
}

export async function deleteThreat(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const row = await IsraThreatLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Threat not found", "THREAT_NOT_FOUND");
  try {
    await row.destroy();
  } catch {
    throw new ConflictError("Threat is referenced by the knowledge map and cannot be deleted", "THREAT_IN_USE");
  }
  await audit(auth, "isra.threat.deleted", "IsraThreatLibrary", id, ip);
}

// --------------------------------------------------------- Vulnerabilities --

export async function listVulns(params: { category?: string; status?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.category) where.category = params.category;
  if (params.status) where.status = params.status;
  const rows = await IsraVulnLibrary.findAll({ where, order: [["name", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function getVuln(id: string) {
  const row = await IsraVulnLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Vulnerability not found", "VULN_NOT_FOUND");
  return row.get({ plain: true });
}

export interface VulnInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  status?: string;
}

export async function createVuln(auth: AuthContext, input: VulnInput, ip: string | null) {
  const name = (input.name ?? "").trim();
  if (!name) throw new BadRequestError("Vulnerability name is required", "NAME_REQUIRED");
  const existing = await IsraVulnLibrary.findAll({ attributes: ["id"] });
  const id = nextSeqId(existing.map((r) => r.id), "VUL");
  const row = await IsraVulnLibrary.create({ id, name, category: input.category ?? null, description: input.description ?? null, status: input.status ?? "Active" });
  await audit(auth, "isra.vuln.created", "IsraVulnLibrary", id, ip);
  return row.get({ plain: true });
}

export async function updateVuln(auth: AuthContext, id: string, input: VulnInput, ip: string | null) {
  const row = await IsraVulnLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Vulnerability not found", "VULN_NOT_FOUND");
  if (input.name !== undefined) row.name = input.name;
  if (input.category !== undefined) row.category = input.category;
  if (input.description !== undefined) row.description = input.description;
  if (input.status !== undefined) row.status = input.status;
  await row.save();
  await audit(auth, "isra.vuln.updated", "IsraVulnLibrary", id, ip);
  return row.get({ plain: true });
}

export async function deleteVuln(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const row = await IsraVulnLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Vulnerability not found", "VULN_NOT_FOUND");
  try {
    await row.destroy();
  } catch {
    throw new ConflictError("Vulnerability is referenced by the knowledge map and cannot be deleted", "VULN_IN_USE");
  }
  await audit(auth, "isra.vuln.deleted", "IsraVulnLibrary", id, ip);
}

// --------------------------------------------------------- Knowledge maps --

/** V2 baseline map: SA-Subgroup → Threat (`israMapSaThreatV2`, read-only —
 * maintained by re-derivation from the taxonomy, not manual CRUD). */
export async function listKmSaThreat(params: { subgroupId?: string; threatId?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.subgroupId) where.subgroupId = params.subgroupId;
  if (params.threatId) where.threatId = params.threatId;
  const rows = await IsraKmSaThreat.findAll({ where, order: [["subgroupId", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

/** V2 baseline map: Threat → Vulnerability (`israMapThreatVulnV2`, read-only). */
export async function listKmThreatVuln(params: { subgroupId?: string; threatId?: string; vulnId?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.subgroupId) where.subgroupId = params.subgroupId;
  if (params.threatId) where.threatId = params.threatId;
  if (params.vulnId) where.vulnId = params.vulnId;
  const rows = await IsraKmThreatVuln.findAll({ where, order: [["subgroupId", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

/** Platform Vuln → Annex A map (`israMapVulnControl`, 269-row curated CSV
 * seed). Read-only here — the review/publish workflow (`isra2KmSetStatus`/
 * `isra2KmPublish`) is explicitly deferred to a later batch (design doc §4,
 * F-7). Per-tenant suppress/add overlay + the effective view live in
 * `israOrgControl.service.ts`. */
export async function listKmVulnControl(params: { vulnId?: string; annexRef?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.vulnId) where.vulnId = params.vulnId;
  if (params.annexRef) where.annexRef = params.annexRef;
  const rows = await IsraKmVulnControl.findAll({ where, order: [["vulnId", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function getKmMeta() {
  const row = await IsraKmMeta.findOne({ order: [["createdAt", "ASC"]] });
  return row ? row.get({ plain: true }) : null;
}

// ---------------------------------------------------------- Treat templates --

export async function listTreatTemplates(params: { vulnId?: string; annexRef?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (params.vulnId) where.vulnId = params.vulnId;
  if (params.annexRef) where.annexRef = params.annexRef;
  const rows = await IsraTreatTemplate.findAll({ where, order: [["annexRef", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export interface TreatTemplateInput {
  vulnId?: string;
  annexRef?: string;
  actionTemplate?: string;
  mechanism?: string | null;
  notes?: string | null;
}

async function assertVulnAndAnnex(vulnId: string, annexRef: string): Promise<void> {
  if (!(await IsraVulnLibrary.findByPk(vulnId))) throw new BadRequestError("Unknown vulnId", "INVALID_VULN");
  if (!(await IsraAnnexAControl.findByPk(annexRef))) throw new BadRequestError("Unknown annexRef", "INVALID_ANNEX_REF");
}

export async function createTreatTemplate(auth: AuthContext, input: TreatTemplateInput, ip: string | null) {
  const vulnId = input.vulnId ?? "";
  const annexRef = input.annexRef ?? "";
  const actionTemplate = (input.actionTemplate ?? "").trim();
  if (!actionTemplate) throw new BadRequestError("actionTemplate is required", "ACTION_TEMPLATE_REQUIRED");
  await assertVulnAndAnnex(vulnId, annexRef);
  const row = await IsraTreatTemplate.create({ vulnId, annexRef, actionTemplate, mechanism: input.mechanism ?? null, notes: input.notes ?? null });
  await audit(auth, "isra.treatTemplate.created", "IsraTreatTemplate", row.id, ip);
  return row.get({ plain: true });
}

export async function updateTreatTemplate(auth: AuthContext, id: string, input: TreatTemplateInput, ip: string | null) {
  const row = await IsraTreatTemplate.findByPk(id);
  if (!row) throw new NotFoundError("Treatment template not found", "TREAT_TEMPLATE_NOT_FOUND");
  if (input.vulnId !== undefined || input.annexRef !== undefined) {
    await assertVulnAndAnnex(input.vulnId ?? row.vulnId, input.annexRef ?? row.annexRef);
  }
  if (input.vulnId !== undefined) row.vulnId = input.vulnId;
  if (input.annexRef !== undefined) row.annexRef = input.annexRef;
  if (input.actionTemplate !== undefined) row.actionTemplate = input.actionTemplate;
  if (input.mechanism !== undefined) row.mechanism = input.mechanism;
  if (input.notes !== undefined) row.notes = input.notes;
  await row.save();
  await audit(auth, "isra.treatTemplate.updated", "IsraTreatTemplate", id, ip);
  return row.get({ plain: true });
}

export async function deleteTreatTemplate(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const row = await IsraTreatTemplate.findByPk(id);
  if (!row) throw new NotFoundError("Treatment template not found", "TREAT_TEMPLATE_NOT_FOUND");
  await row.destroy();
  await audit(auth, "isra.treatTemplate.deleted", "IsraTreatTemplate", id, ip);
}

// -------------------------------------------------------------- utilities --

/** Distinct category values across the library tables, for FE filter chips. */
export async function listLibraryCategories() {
  const [annex, threats, vulns] = await Promise.all([
    IsraAnnexAControl.findAll({ attributes: ["category"], group: ["category"] }),
    IsraThreatLibrary.findAll({ attributes: ["category"], group: ["category"], where: { category: { [Op.ne]: null } } }),
    IsraVulnLibrary.findAll({ attributes: ["category"], group: ["category"], where: { category: { [Op.ne]: null } } }),
  ]);
  return {
    annexA: annex.map((r) => r.category).filter((c): c is string => !!c).sort(),
    threats: threats.map((r) => r.category).filter((c): c is string => !!c).sort(),
    vulns: vulns.map((r) => r.category).filter((c): c is string => !!c).sort(),
  };
}

