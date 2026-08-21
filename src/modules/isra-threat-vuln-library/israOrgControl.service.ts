import {
  IsraOrgControl,
  IsraControlMaturityBaseline,
  IsraVulnControlOverlay,
  IsraAnnexAControl,
  IsraKmVulnControl,
  IsraVulnLibrary,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { ISRA_OVERLAY_KIND } from "../../db/models/israOrgControl.models";

/**
 * ISRA + SoA (F-2b) — org-level control customization + maturity baselines +
 * the Vuln→Annex A tenant overlay (design doc §2.5). Schema-level CRUD
 * scaffolding only this batch — the UI lands in F-5d (Controls tab +
 * maturity baseline editor); this module exists so that later batch doesn't
 * have to build the service/route layer from scratch.
 *
 * `isra_org_controls` deliberately holds only rows an org actually
 * customized or added (not a full 93-row clone per org like OD's in-memory
 * shortcut) — `listEffectiveControls`/`getEffectiveControl` implement the
 * "org row if present, else the platform `isra_annex_a_controls` row" merge
 * OD calls `israEffLib()`.
 *
 * `isra_vuln_control_overlay` is a per-tenant suppress/add layer on top of
 * the platform `isra_km_vuln_control` map (design doc §1.3) —
 * `listEffectiveVulnControlMap` computes base-minus-suppressed-plus-added at
 * read time, the same as OD's `israMapVulnEffective(t)`.
 */

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null): Promise<void> {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

// ------------------------------------------------------------ Org Controls --

export interface EffectiveControl {
  ref: string;
  name: string;
  category: string | null;
  csf: string | null;
  type: string | null;
  fnP: boolean;
  fnD: boolean;
  fnC: boolean;
  dedL: boolean;
  dedC: boolean;
  description: string | null;
  custom: boolean;
  source: "org" | "platform";
}

/** Every platform Annex A control, overlaid with this org's customizations,
 * plus any wholly org-custom (`custom:true`) controls that have no platform
 * counterpart. */
export async function listEffectiveControls(auth: AuthContext): Promise<EffectiveControl[]> {
  const [platformRows, orgRows] = await Promise.all([
    IsraAnnexAControl.findAll({ order: [["ref", "ASC"]] }),
    IsraOrgControl.findAll({ where: { orgId: auth.orgId } }),
  ]);
  const orgByRef = new Map(orgRows.map((r) => [r.ref, r]));
  const out: EffectiveControl[] = platformRows.map((p) => {
    const o = orgByRef.get(p.ref);
    return o
      ? { ref: o.ref, name: o.name, category: o.category, csf: o.csf, type: o.type, fnP: o.fnP, fnD: o.fnD, fnC: o.fnC, dedL: o.dedL, dedC: o.dedC, description: o.description, custom: o.custom, source: "org" }
      : { ref: p.ref, name: p.name, category: p.category, csf: p.csf, type: p.type, fnP: p.fnP, fnD: p.fnD, fnC: p.fnC, dedL: p.dedL, dedC: p.dedC, description: p.description, custom: false, source: "platform" };
  });
  const platformRefs = new Set(platformRows.map((p) => p.ref));
  for (const o of orgRows) {
    if (platformRefs.has(o.ref)) continue; // already merged above
    out.push({ ref: o.ref, name: o.name, category: o.category, csf: o.csf, type: o.type, fnP: o.fnP, fnD: o.fnD, fnC: o.fnC, dedL: o.dedL, dedC: o.dedC, description: o.description, custom: o.custom, source: "org" });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

export async function getEffectiveControl(auth: AuthContext, ref: string): Promise<EffectiveControl> {
  const org = await IsraOrgControl.findOne({ where: { orgId: auth.orgId, ref } });
  if (org) return { ref: org.ref, name: org.name, category: org.category, csf: org.csf, type: org.type, fnP: org.fnP, fnD: org.fnD, fnC: org.fnC, dedL: org.dedL, dedC: org.dedC, description: org.description, custom: org.custom, source: "org" };
  const platform = await IsraAnnexAControl.findByPk(ref);
  if (!platform) throw new NotFoundError("Control not found", "CONTROL_NOT_FOUND");
  return { ref: platform.ref, name: platform.name, category: platform.category, csf: platform.csf, type: platform.type, fnP: platform.fnP, fnD: platform.fnD, fnC: platform.fnC, dedL: platform.dedL, dedC: platform.dedC, description: platform.description, custom: false, source: "platform" };
}

export interface OrgControlInput {
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

const ORG_CONTROL_FIELDS = ["name", "category", "csf", "type", "fnP", "fnD", "fnC", "dedL", "dedC", "description"] as const;

/** Upsert an org's customization of a platform control (`ref` matches an
 * `isra_annex_a_controls.ref`) or a wholly custom control (any other `ref`,
 * e.g. `CUS-001` — the caller is responsible for a collision-free id). */
export async function upsertOrgControl(auth: AuthContext, ref: string, input: OrgControlInput, ip: string | null): Promise<EffectiveControl> {
  const platform = await IsraAnnexAControl.findByPk(ref);
  const isCustom = !platform;
  if (isCustom && !input.name?.trim()) throw new BadRequestError("name is required for a custom control", "NAME_REQUIRED");

  const [row] = await IsraOrgControl.findOrCreate({
    where: { orgId: auth.orgId, ref },
    defaults: {
      orgId: auth.orgId,
      ref,
      custom: isCustom,
      name: input.name ?? platform?.name ?? ref,
      category: input.category ?? platform?.category ?? null,
      csf: input.csf ?? platform?.csf ?? null,
      type: input.type ?? platform?.type ?? null,
      fnP: input.fnP ?? platform?.fnP ?? false,
      fnD: input.fnD ?? platform?.fnD ?? false,
      fnC: input.fnC ?? platform?.fnC ?? false,
      dedL: input.dedL ?? platform?.dedL ?? false,
      dedC: input.dedC ?? platform?.dedC ?? false,
      description: input.description ?? platform?.description ?? null,
    },
  });
  for (const k of ORG_CONTROL_FIELDS) if (input[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = input[k];
  await row.save();
  await audit(auth, "isra.orgControl.upserted", "IsraOrgControl", row.id, ip);
  return { ref: row.ref, name: row.name, category: row.category, csf: row.csf, type: row.type, fnP: row.fnP, fnD: row.fnD, fnC: row.fnC, dedL: row.dedL, dedC: row.dedC, description: row.description, custom: row.custom, source: "org" };
}

/** Removes this org's customization — the control reverts to the platform
 * default (a no-op for a wholly-custom control's platform counterpart, since
 * none exists; the ref simply stops resolving). */
export async function deleteOrgControl(auth: AuthContext, ref: string, ip: string | null): Promise<void> {
  const row = await IsraOrgControl.findOne({ where: { orgId: auth.orgId, ref } });
  if (!row) throw new NotFoundError("Org control override not found", "ORG_CONTROL_NOT_FOUND");
  await row.destroy();
  await audit(auth, "isra.orgControl.deleted", "IsraOrgControl", ref, ip);
}

// ------------------------------------------------------- Maturity baselines --

const MAT_DIMENSIONS = ["gov", "doc", "impl", "mon", "comp"] as const;
export interface MaturityBaselineInput {
  gov?: number | null;
  doc?: number | null;
  impl?: number | null;
  mon?: number | null;
  comp?: number | null;
}

function assertMaturityRange(input: MaturityBaselineInput): void {
  for (const k of MAT_DIMENSIONS) {
    const v = input[k];
    if (v == null) continue;
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new BadRequestError(`${k} must be an integer 1-5`, "INVALID_MATURITY_VALUE");
  }
}

export async function listMaturityBaselines(auth: AuthContext) {
  const rows = await IsraControlMaturityBaseline.findAll({ where: { orgId: auth.orgId }, order: [["annexRef", "ASC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function upsertMaturityBaseline(auth: AuthContext, annexRef: string, input: MaturityBaselineInput, ip: string | null) {
  if (!(await IsraAnnexAControl.findByPk(annexRef))) throw new BadRequestError("Unknown annexRef", "INVALID_ANNEX_REF");
  assertMaturityRange(input);
  const [row] = await IsraControlMaturityBaseline.findOrCreate({
    where: { orgId: auth.orgId, annexRef },
    defaults: { orgId: auth.orgId, annexRef, gov: input.gov ?? null, doc: input.doc ?? null, impl: input.impl ?? null, mon: input.mon ?? null, comp: input.comp ?? null, setBy: auth.userId, setAt: new Date() },
  });
  for (const k of MAT_DIMENSIONS) if (input[k] !== undefined) row[k] = input[k] as number | null;
  row.setBy = auth.userId;
  row.setAt = new Date();
  await row.save();
  await audit(auth, "isra.maturityBaseline.upserted", "IsraControlMaturityBaseline", row.id, ip);
  return row.get({ plain: true });
}

export async function deleteMaturityBaseline(auth: AuthContext, annexRef: string, ip: string | null): Promise<void> {
  const row = await IsraControlMaturityBaseline.findOne({ where: { orgId: auth.orgId, annexRef } });
  if (!row) throw new NotFoundError("Maturity baseline not found", "MATURITY_BASELINE_NOT_FOUND");
  await row.destroy();
  await audit(auth, "isra.maturityBaseline.deleted", "IsraControlMaturityBaseline", annexRef, ip);
}

// --------------------------------------------------- Vuln→Control overlay --

export async function listVulnControlOverlay(auth: AuthContext) {
  const rows = await IsraVulnControlOverlay.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

export interface VulnControlOverlayInput {
  kind: string;
  edgeId?: string | null;
  vulnId?: string | null;
  annexRef?: string | null;
  role?: string | null;
  affects?: string | null;
  strength?: string | null;
  mechanism?: string | null;
}

export async function createVulnControlOverlay(auth: AuthContext, input: VulnControlOverlayInput, ip: string | null) {
  if (!ISRA_OVERLAY_KIND.includes(input.kind as (typeof ISRA_OVERLAY_KIND)[number])) {
    throw new BadRequestError(`kind must be one of ${ISRA_OVERLAY_KIND.join(", ")}`, "INVALID_KIND");
  }
  if (input.kind === "suppress") {
    if (!input.edgeId) throw new BadRequestError("edgeId is required to suppress a platform edge", "EDGE_ID_REQUIRED");
    const edge = await IsraKmVulnControl.findByPk(input.edgeId);
    if (!edge) throw new BadRequestError("Unknown edgeId", "INVALID_EDGE_ID");
    const dupe = await IsraVulnControlOverlay.findOne({ where: { orgId: auth.orgId, kind: "suppress", edgeId: input.edgeId, status: "Active" } });
    if (dupe) throw new ConflictError("This edge is already suppressed for this organization", "ALREADY_SUPPRESSED");
  } else {
    if (!input.vulnId || !input.annexRef) throw new BadRequestError("vulnId and annexRef are required to add a tenant edge", "VULN_AND_ANNEX_REQUIRED");
    if (!(await IsraVulnLibrary.findByPk(input.vulnId))) throw new BadRequestError("Unknown vulnId", "INVALID_VULN");
    if (!(await IsraAnnexAControl.findByPk(input.annexRef))) throw new BadRequestError("Unknown annexRef", "INVALID_ANNEX_REF");
  }
  const row = await IsraVulnControlOverlay.create({
    orgId: auth.orgId,
    kind: input.kind,
    edgeId: input.kind === "suppress" ? (input.edgeId ?? null) : null,
    vulnId: input.kind === "add" ? (input.vulnId ?? null) : null,
    annexRef: input.kind === "add" ? (input.annexRef ?? null) : null,
    role: input.kind === "add" ? (input.role ?? null) : null,
    affects: input.kind === "add" ? (input.affects ?? null) : null,
    strength: input.kind === "add" ? (input.strength ?? null) : null,
    mechanism: input.kind === "add" ? (input.mechanism ?? null) : null,
    status: "Active",
    createdBy: auth.userId,
  });
  await audit(auth, "isra.vulnControlOverlay.created", "IsraVulnControlOverlay", row.id, ip);
  return row.get({ plain: true });
}

export async function deleteVulnControlOverlay(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const row = await IsraVulnControlOverlay.findOne({ where: { id, orgId: auth.orgId } });
  if (!row) throw new NotFoundError("Overlay entry not found", "OVERLAY_NOT_FOUND");
  await row.destroy();
  await audit(auth, "isra.vulnControlOverlay.deleted", "IsraVulnControlOverlay", id, ip);
}

export interface EffectiveVulnControlEdge {
  id: string;
  vulnId: string;
  annexRef: string;
  role: string | null;
  affects: string | null;
  strength: string | null;
  mechanism: string | null;
  origin: "platform" | "org";
}

/** Base platform Vuln→Annex A map, minus this org's suppressed edges, plus
 * this org's added edges — OD's `israMapVulnEffective(t)`. */
export async function listEffectiveVulnControlMap(auth: AuthContext): Promise<EffectiveVulnControlEdge[]> {
  const [platformRows, overlayRows] = await Promise.all([
    IsraKmVulnControl.findAll(),
    IsraVulnControlOverlay.findAll({ where: { orgId: auth.orgId, status: "Active" } }),
  ]);
  const suppressed = new Set(overlayRows.filter((o) => o.kind === "suppress" && o.edgeId).map((o) => o.edgeId as string));
  const out: EffectiveVulnControlEdge[] = platformRows
    .filter((p) => !suppressed.has(p.id))
    .map((p) => ({ id: p.id, vulnId: p.vulnId, annexRef: p.annexRef, role: p.role, affects: p.affects, strength: p.strength, mechanism: p.mechanism, origin: "platform" as const }));
  for (const o of overlayRows) {
    if (o.kind !== "add" || !o.vulnId || !o.annexRef) continue;
    out.push({ id: o.id, vulnId: o.vulnId, annexRef: o.annexRef, role: o.role, affects: o.affects, strength: o.strength, mechanism: o.mechanism, origin: "org" });
  }
  return out.sort((a, b) => a.vulnId.localeCompare(b.vulnId) || a.annexRef.localeCompare(b.annexRef));
}
