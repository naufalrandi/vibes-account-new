import { DocumentSettings, ImplementationRecord, User, WorkUnit } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError } from "../../lib/errors";
import type { RecordView } from "./implementation.service";

/**
 * Internal Documents (controlled documents) vocabulary + derivations — the
 * server-side half of OD's `cd*` helpers (index.html:12716–12730). The record
 * bodies live 1:1 in `implementation_records.data`; this module owns the ID
 * scheme, the review-cadence math, and the per-org `cdSettings` gates.
 */

/** OD `CD_TYPE_CODE` (12717) — document type → ID prefix. Types without a code fall back to DOC. */
export const CD_TYPE_CODE: Record<string, string> = {
  Policy: "POL", Manual: "MAN", Procedure: "PROC", "Work Instruction": "WI",
  Guideline: "GUIDE", Form: "FORM", Template: "TMPL", Register: "REG",
  Plan: "PLAN", Report: "RPT", Record: "REC", "External Document": "EXT",
};

/** OD `cdNewId` (12730) — first selected framework tags the ID for internal documents. */
export const CD_FW_CODE: Record<string, string> = {
  "ISO 9001:2015": "QMS", "ISO 14001:2015": "EMS", "ISO 45001:2018": "OHSM",
  "ISO/IEC 27001:2022": "ISMS", "ISO/IEC 27701:2025": "PIMS",
};

/** OD `CD_FREQ_MO` (12723) — review cadence in months. Superset of the policies map: adds "Every 3 years". */
export const CD_FREQ_MO: Record<string, number> = {
  Quarterly: 3, "Semi-annually": 6, Annually: 12, "Every 2 years": 24, "Every 3 years": 36, Custom: 12,
};

/** OD `cdNextReview` (12727): effective date + review frequency → next-review ISO stamp ("" when no effective date). */
export function cdNextReview(effectiveDate: unknown, reviewFreq: unknown): string {
  if (!effectiveDate || typeof effectiveDate !== "string") return "";
  const d = new Date(effectiveDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + (CD_FREQ_MO[String(reviewFreq ?? "")] ?? 12));
  return d.toISOString();
}

/** OD `cdSettings` defaults (12726). */
export const DOC_SETTINGS_DEFAULTS = {
  requireApprover: true, requireChange: true, requireFreq: true, requireOwner: true,
  allowEditPublished: false, enableAck: true, enableExternal: true, enableInline: false,
};
export type DocSettings = { [K in keyof typeof DOC_SETTINGS_DEFAULTS]: boolean };

/** Per-org settings with OD's defaults for any missing row/key. */
export async function getDocSettings(orgId: string): Promise<DocSettings> {
  const row = await DocumentSettings.findOne({ where: { orgId } });
  return { ...DOC_SETTINGS_DEFAULTS, ...(row?.settings ?? {}) };
}

export async function setDocSettings(auth: AuthContext, input: Record<string, unknown>, ip: string | null): Promise<DocSettings> {
  const [row] = await DocumentSettings.findOrCreate({
    where: { orgId: auth.orgId },
    defaults: { orgId: auth.orgId, settings: {} },
  });
  const next: Record<string, boolean> = { ...row.settings };
  for (const key of Object.keys(DOC_SETTINGS_DEFAULTS)) {
    const v = input[key];
    if (typeof v === "boolean") next[key] = v;
  }
  row.settings = next;
  await row.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId,
    action: "ms.documents.settingsUpdated", entityType: "DocumentSettings", entityId: row.id, sourceIp: ip, result: "Success",
  });
  return { ...DOC_SETTINGS_DEFAULTS, ...next };
}

/**
 * OD `cdSave` gates (12905–12909): the org's document-control settings decide
 * which metadata is mandatory on every content save.
 */
export function assertDocumentSaveGates(
  s: DocSettings,
  merged: { owner: unknown; approver: unknown; changeSummary: unknown },
): void {
  const empty = (v: unknown) => v == null || String(v).trim() === "";
  if (s.requireOwner && empty(merged.owner)) throw new BadRequestError("Document owner is required", "DOC_OWNER_REQUIRED");
  if (s.requireApprover && empty(merged.approver)) throw new BadRequestError("Approver is required", "DOC_APPROVER_REQUIRED");
  if (s.requireChange && empty(merged.changeSummary)) throw new BadRequestError("Change summary is required", "DOC_CHANGE_REQUIRED");
}

/**
 * OD `cdNum` + `cdNewId` (12729–12730): one number sequence per tenant across
 * ALL controlled documents (regardless of prefix), then
 * `TYPECODE[-FWCODE]-NNNN` — external documents are always `EXT-STD-NNNN`.
 */
export async function documentCode(orgId: string, type: unknown, frameworks: string[] | undefined): Promise<string> {
  const rows = await ImplementationRecord.findAll({ where: { orgId, module: "documents" }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt((r.code || "").replace(/^[A-Z]+-(?:[A-Z]+-)?/, "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const num = String(max + 1).padStart(4, "0");
  const t = String(type ?? "");
  if (t === "External Document") return `EXT-STD-${num}`;
  const code = CD_TYPE_CODE[t] ?? "DOC";
  const fwc = frameworks?.[0] ? CD_FW_CODE[frameworks[0]] : undefined;
  return `${code}${fwc ? `-${fwc}` : ""}-${num}`;
}

/**
 * Field derivations OD applies on every form save (12912): `nextReview` is
 * always recomputed from effective date + review frequency, never hand-set.
 * Returns a new object — the input is not mutated.
 */
export function deriveDocumentData(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, nextReview: cdNextReview(data.effectiveDate, data.reviewFreq ?? "Annually") };
}

/**
 * OD `cdForm` cd-vscope (core.js:19828): per-unit/per-user view-access
 * scoping. OD itself never enforces it (the field only feeds a display label,
 * `cdViewAccessLabel`) — a control the API ignores is worse than none, so this
 * port enforces it server-side instead of copying OD's cosmetic-only behavior.
 * The document owner, its creator, and org admins always see it regardless of
 * scope, matching how every other gate in this module treats authorship.
 */
function canViewDocument(
  viewer: { fullName: string | null; workUnit: string | null; isSuperAdmin: boolean },
  rec: { owner: string | null; data: Record<string, unknown> },
  unitNameById: Map<string, string>,
): boolean {
  const scope = typeof rec.data.viewScope === "string" ? rec.data.viewScope : "Everyone";
  if (scope === "Everyone" || viewer.isSuperAdmin) return true;
  if (viewer.fullName && (viewer.fullName === rec.owner || viewer.fullName === rec.data.createdBy)) return true;
  if (scope === "Specific Users") {
    const allowed = Array.isArray(rec.data.viewUsers) ? (rec.data.viewUsers as unknown[]) : [];
    return viewer.fullName !== null && allowed.includes(viewer.fullName);
  }
  if (scope === "Work Units") {
    const units = Array.isArray(rec.data.viewUnits) ? (rec.data.viewUnits as unknown[]) : [];
    if (!viewer.workUnit) return false;
    return units.some((id) => typeof id === "string" && unitNameById.get(id) === viewer.workUnit);
  }
  return true;
}

/**
 * Filters a document list down to what `auth`'s actor may see under each
 * row's `viewScope`/`viewUnits`/`viewUsers` (OD cd-vscope). Called from
 * `implementation.service.listRecords` for the `documents` module — the only
 * read path for controlled documents (there is no single-record GET route).
 */
export async function filterViewableDocuments(auth: AuthContext, views: RecordView[]): Promise<RecordView[]> {
  if (views.length === 0 || auth.isSuperAdmin) return views;
  const user = auth.userId ? await User.findOne({ where: { id: auth.userId, orgId: auth.orgId } }) : null;
  const viewer = { fullName: user?.fullName ?? null, workUnit: user?.workUnit ?? null, isSuperAdmin: auth.isSuperAdmin };

  const unitIds = new Set<string>();
  for (const v of views) {
    const units = (v.data as Record<string, unknown>).viewUnits;
    if (Array.isArray(units)) for (const id of units) if (typeof id === "string") unitIds.add(id);
  }
  const unitNameById = new Map<string, string>();
  if (unitIds.size > 0) {
    const rows = await WorkUnit.findAll({ where: { id: [...unitIds], orgId: auth.orgId }, attributes: ["id", "name"] });
    for (const r of rows) unitNameById.set(r.id, r.name);
  }
  return views.filter((v) => canViewDocument(viewer, { owner: v.owner, data: v.data as Record<string, unknown> }, unitNameById));
}
