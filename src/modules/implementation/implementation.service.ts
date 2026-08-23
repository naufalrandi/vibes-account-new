import { Op, type WhereOptions } from "sequelize";
import { CompetenceGap, FrameworkElement, ImplementationRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { MS_MODULES, isMsModule, enrichData } from "./registry";
import {
  assertReviewCreateStatus, assertReviewSchedule, assertReviewTransition,
  assignReviewTopicIds, reviewTransitionStamp,
} from "./reviewLifecycle";
import { logActivity, actorName } from "../record-events/recordEvent.service";
import { assertDocumentSaveGates, deriveDocumentData, documentCode, getDocSettings } from "./documentControl";
import { extDocCode, folderDocumentCount, seedExternalDocsIfNeeded } from "./externalDocs";
import { decorateCampaignView, getAwSettings, topicHasMaterial } from "./awarenessControl";
import { derivePolicyData, policyCode, polNextVersion } from "./policyControl";
import { assertTrainingVocab, bindTrainingRecordToGap, decorateTrainingView } from "./trainingLifecycle";

export interface RecordView {
  id: string;
  orgId: string;
  module: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  data: Record<string, unknown>;
  elementId: string | null;
  frameworks: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordInput {
  title?: string;
  status?: string;
  owner?: string | null;
  data?: Record<string, unknown>;
  elementId?: string | null;
  frameworks?: string[];
}

// Compliance obligations moved from an invented 4-status vocabulary
// (Active/Completed/On Hold/Waived) to OD's real one (Active/Under
// Review/Archived — registry.ts `compliance`). Rows saved under the old
// vocabulary are never rewritten by a migration (JSONB/status is
// point-in-time data, not a schema); normalize on read instead so every
// client only ever sees the three current statuses. The stored value only
// changes once the record is next saved through `updateRecord`, which
// validates against the new set.
const LEGACY_STATUS_MAP: Partial<Record<string, Record<string, string>>> = {
  compliance: { Completed: "Archived", "On Hold": "Under Review", Waived: "Archived" },
};

function view(r: ImplementationRecord): RecordView {
  const legacyStatus = LEGACY_STATUS_MAP[r.module]?.[r.status];
  return {
    id: r.id, orgId: r.orgId, module: r.module, code: r.code, title: r.title,
    // Derived display fields (riskScore, reviews' scheduled/topicsCount/open
    // counts) are recomputed on read so rows written before an enrichment
    // existed still render it (the mock client enriches on read the same way).
    status: legacyStatus ?? r.status, owner: r.owner, data: enrichData(r.module, r.data ?? {}), elementId: r.elementId,
    frameworks: r.frameworks ?? [], createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * Read-time view decoration that depends on the whole (status + data) shape,
 * not just `data` (unlike `enrichData`) — awareness-campaigns' ackRate/evalRate
 * roll-ups and training's derived Overdue status both need `status` alongside
 * the JSONB payload.
 */
function decorateForModule(module: string, v: RecordView): RecordView {
  if (module === "awareness-campaigns") return decorateCampaignView(v);
  if (module === "training") return decorateTrainingView(v);
  return v;
}

function requireModule(module: string) {
  if (!isMsModule(module)) throw new NotFoundError("Unknown register module", "MODULE_NOT_FOUND");
  return MS_MODULES[module];
}

function assertStatus(module: string, status: string) {
  const def = MS_MODULES[module];
  if (!def.statuses.includes(status) && status !== "Archived") {
    throw new BadRequestError(`Invalid status "${status}" for ${module}`, "INVALID_STATUS");
  }
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function nextCode(module: string, orgId: string): Promise<string> {
  const { prefix } = MS_MODULES[module];
  // Sequences are per organization (OD numbers per tenant) — without the org
  // filter every tenant on the platform would share one global counter.
  const rows = await ImplementationRecord.findAll({ where: { module, orgId }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * OD `ocFweCode`/`ocNewId` (app.html:8119–8120): the `context` register's
 * code prefix is the code of the "Organizational Context" FWE element itself
 * (falling back to "FWE-001" if that element hasn't been seeded), and — unlike
 * every other register — the numeric suffix is NOT zero-padded (`pre+'-'+(mx+1)`).
 * Bypasses `nextCode()` entirely, the same way documents/policies bypass it
 * for their own dynamic codes.
 *
 * Scoped per organization (migration 0069), matching OD's per-tenant `ocNewId`.
 */
async function contextCode(orgId: string): Promise<string> {
  const fwe = await FrameworkElement.findOne({ where: { name: "Organizational Context" } });
  const prefix = fwe?.code ?? "FWE-001";
  const rows = await ImplementationRecord.findAll({ where: { module: "context", orgId }, attributes: ["code"] });
  const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = r.code.match(re);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

export async function listRecords(auth: AuthContext, module: string, filters: { orgId?: string } = {}): Promise<RecordView[]> {
  requireModule(module);
  const where: WhereOptions = { module };
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  // OD `edSeedIfNeeded` (13034): the External Documents explorer lazy-seeds its
  // 12 folders + 6 starter documents per org on the first records read. Runs
  // after the visibility checks so a caller can never seed an org it cannot see.
  if (module === "records" || module === "record-folders") {
    await seedExternalDocsIfNeeded(filters.orgId ?? auth.orgId);
  }
  const rows = await ImplementationRecord.findAll({ where, order: [["createdAt", "DESC"]] });
  // Awareness campaigns are always served with fresh ackRate/evalRate roll-ups
  // and the time-derived Overdue / Partially Completed / Completed status
  // (awarenessControl.decorateCampaignView); training items get OD's derived
  // Overdue status the same way (decorateTrainingView) — stored status is
  // only the mutation-time snapshot for both.
  return rows.map((r) => decorateForModule(module, view(r)));
}

async function requireRecord(auth: AuthContext, module: string, id: string): Promise<ImplementationRecord> {
  requireModule(module);
  const r = await ImplementationRecord.findOne({ where: { id, module } });
  if (!r) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  await assertCanSeeOrg(auth, r.orgId);
  return r;
}

export async function createRecord(auth: AuthContext, module: string, input: RecordInput, orgId: string | undefined, ip: string | null): Promise<RecordView> {
  const def = requireModule(module);
  const targetOrg = orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  // The create-time default is `createStatuses[0]` when a module declares
  // one (P-6.4: e.g. `cab-clients` defaults to "Certified", matching OD's
  // `cabClientForm`, while its `statuses[0]` stays "Applicant" for display/
  // parity-test ordering); otherwise it's `statuses[0]`, unchanged.
  const status = input.status ?? def.createStatuses?.[0] ?? def.statuses[0];
  assertStatus(module, status);
  // The awareness-topic material gate holds on create too (OD `awTopicSave`
  // refuses to create straight at Active without a material).
  await assertActivatable(module, targetOrg, {}, status, input);
  let inputData = input.data ?? {};
  // OD `mrSave`: a review is born Draft or Scheduled, needs a date + time
  // (11124–11126), and its agenda topics draw ids from the org-wide MRI sequence.
  if (module === "reviews") {
    assertReviewCreateStatus(status);
    assertReviewSchedule(inputData);
    inputData = await assignReviewTopicIds(targetOrg, inputData);
  }
  let data = enrichData(module, inputData);
  // OD `conForm`/`conSave`: a concern's reporter is the actor who submitted
  // it (`ocActor()`), stamped automatically rather than typed — surfaced on
  // the register as "Reported by".
  if (module === "concerns" && !data.reportedBy) {
    data = { ...data, reportedBy: (await actorName(auth)) ?? "" };
  }
  // OD `tpSave`: source/type/delivery must come from the Training Plan vocabulary.
  if (module === "training") assertTrainingVocab(data);
  let code: string;
  if (module === "context") {
    code = await contextCode(targetOrg);
  } else if (module === "documents") {
    // OD `cdSave`: the org's document-control settings gate every content save,
    // the ID follows `TYPECODE[-FWCODE]-NNNN` (`cdNewId`), a new document starts
    // at v0.1, and `nextReview` is derived from effective date + frequency.
    assertDocumentSaveGates(await getDocSettings(targetOrg), {
      owner: input.owner, approver: data.approver, changeSummary: data.changeSummary,
    });
    data = deriveDocumentData(data);
    if (!data.version) data.version = "0.1";
    code = await documentCode(targetOrg, data.type, input.frameworks);
  } else if (module === "policies") {
    // OD `polNewId` (10110): `POL-<FWCODE>-NNNN` for a High-Level policy with a
    // coded framework, `POL-NNNN` otherwise; versions are integers starting at
    // "1"; `nextReview` is derived from effective date + review frequency.
    data = derivePolicyData(data);
    if (!data.version) data.version = "1";
    code = await policyCode(targetOrg, data.category, input.frameworks);
  } else if (module === "records") {
    // OD `edDocNewId` (13023): `EXT-<CAT_CODE>-NNNN` from the document's
    // category, one number sequence per tenant across all external documents.
    code = await extDocCode(targetOrg, data.category);
  } else {
    code = await nextCode(module, targetOrg);
  }
  const r = await ImplementationRecord.create({
    orgId: targetOrg,
    module,
    code,
    title: input.title.trim(),
    status,
    owner: input.owner ?? null,
    data,
    elementId: input.elementId ?? null,
    frameworks: input.frameworks ?? [],
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: targetOrg,
    action: `ms.${module}.created`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  await logActivity(auth, targetOrg, module, r.id, "Record created");
  // OD `tpSave` create path (14150): `gp` is only resolved when the form's
  // source is literally "Competence Gap" — a manually-entered gapId on a
  // Manual-sourced item is never bound. Matches OD's `src==='Competence
  // Gap'?ngById(...):null` gate exactly (the later complete/reassess/close
  // cascades, unlike this one, key off `gapId` alone — see trainingLifecycle.ts).
  if (module === "training" && data.source === "Competence Gap" && typeof data.gapId === "string" && data.gapId) {
    await bindTrainingRecordToGap(auth, data.gapId, r.code, ip);
  }
  return decorateForModule(module, view(r));
}

/** Bump a dotted document version the way OD does: 1.0 → 1.1, blank → 1.0. */
function nextVersion(current: unknown): string {
  const n = Number.parseFloat(String(current ?? ""));
  return Number.isFinite(n) ? (n + 0.1).toFixed(1) : "1.0";
}

/**
 * Per-module fork parameters for `forkPublishedRecord` — how the new draft's
 * version, ID, derived fields, cleared stamps, and activity strings differ
 * between controlled documents (dotted versions, `cdNewId` codes) and policies
 * (integer versions, `polNewId` codes).
 */
interface PublishedForkSpec {
  nextVersion: (current: unknown) => string;
  deriveData: (data: Record<string, unknown>) => Record<string, unknown>;
  makeCode: (orgId: string, data: Record<string, unknown>, frameworks: string[] | undefined) => Promise<string>;
  /** Approval/publish stamps the fresh draft must NOT inherit (OD clears them on fork). */
  clearedStamps: string[];
  draftActivity: (version: string, sourceCode: string) => string;
  sourceActivity: (draftCode: string, version: string) => string;
}

const DOCUMENT_FORK: PublishedForkSpec = {
  nextVersion,
  deriveData: deriveDocumentData,
  makeCode: (orgId, data, fws) => documentCode(orgId, data.type, fws),
  clearedStamps: ["submittedBy", "submittedDate", "approvedBy", "approvedDate", "publishedBy", "publishedDate"],
  draftActivity: (v, src) => `New draft v${v} from ${src}`,
  sourceActivity: (code, v) => `Revision started — new draft ${code} (v${v})`,
};

const POLICY_FORK: PublishedForkSpec = {
  nextVersion: polNextVersion,
  deriveData: derivePolicyData,
  makeCode: (orgId, data, fws) => policyCode(orgId, data.category, fws),
  clearedStamps: ["approvedBy", "approvedDate", "publishedBy", "publishedDate"],
  // OD `polSave` (10847): the fork's creation entry reads
  // "New draft version vN from POL-…".
  draftActivity: (v, src) => `New draft version v${v} from ${src}`,
  sourceActivity: (code, v) => `Revision started — new draft ${code} (v${v})`,
};

/**
 * OD `cdSave` (12921–12925) / `polSave` (10847): editing an already-published
 * controlled document or policy does not mutate it in place — it forks a new
 * Draft at the next version in the same lineage. The published original STAYS
 * Published while the draft exists (the org keeps a live document through the
 * whole revision cycle); it is superseded only when the new version itself is
 * published (`publishWithLineage` in approval.service.ts). A pure status
 * transition (e.g. Published → Archived) is not an edit and passes straight
 * through.
 */
async function forkPublishedRecord(
  auth: AuthContext, r: ImplementationRecord, input: RecordInput, ip: string | null, spec: PublishedForkSpec,
): Promise<RecordView> {
  const prevData = (r.data ?? {}) as Record<string, unknown>;
  const data = spec.deriveData({ ...prevData, ...(input.data ?? {}) });
  const lineage = (prevData.lineageId as string) ?? r.id;
  data.version = spec.nextVersion(prevData.version);
  data.lineageId = lineage;
  data.prevVersionId = r.id;
  // The fresh draft carries no approval history of its own and is not
  // superseded by / superseding anything yet.
  for (const key of spec.clearedStamps) data[key] = "";
  delete data.supersedes;
  delete data.supersededBy;

  const draft = await ImplementationRecord.create({
    orgId: r.orgId,
    module: r.module,
    code: await spec.makeCode(r.orgId, data, input.frameworks ?? r.frameworks ?? []),
    title: input.title?.trim() ?? r.title,
    status: "Draft",
    owner: input.owner !== undefined ? input.owner : r.owner,
    data: enrichData(r.module, data),
    elementId: input.elementId !== undefined ? input.elementId : r.elementId,
    frameworks: input.frameworks ?? r.frameworks,
  });

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.${r.module}.revised`, entityType: "ImplementationRecord", entityId: draft.id, sourceIp: ip, result: "Success",
    metadata: { prevVersionId: r.id, lineageId: lineage, version: data.version },
  });
  await logActivity(auth, r.orgId, r.module, r.id, spec.sourceActivity(draft.code, String(data.version)));
  await logActivity(auth, r.orgId, r.module, draft.id, spec.draftActivity(String(data.version), r.code));
  return view(draft);
}

/** OD `EFF_RESULT` values that do not clear the effectiveness gate. */
const EFF_UNRESOLVED = new Set(["Not Checked", "Not Effective", "Too Early to Determine"]);

/**
 * OD `ncClose` (11460): a nonconformity cannot be closed while its CAP's own
 * effectiveness check is required and unresolved. The gate is conditional on
 * the CAP's `effRequired` flag (OD `capForm` "Effectiveness Check Required"):
 * when it's No, the NC can close without ever running a check; when Yes, a
 * Not Checked / Not Effective / Too Early to Determine result still blocks
 * closure. No CAP at all means nothing to gate on — mirrors OD's own
 * `n.cap && n.cap.effRequired && …` short-circuit. Enforced server-side so
 * the gate holds regardless of which client performs the transition,
 * including a CAP-driven auto-close (see `applyCapSideEffects`).
 */
function assertClosable(module: string, r: ImplementationRecord, nextStatus: string | undefined, input: RecordInput): void {
  if (module !== "nonconformities" || nextStatus !== "Closed") return;
  const existing = (r.data ?? {}) as Record<string, unknown>;
  const providedData = input.data as Record<string, unknown> | undefined;
  const cap = (providedData && "cap" in providedData ? providedData.cap : existing.cap) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!cap || cap.effRequired !== true) return;
  const result = cap.effResult as string | undefined;
  if (!result || EFF_UNRESOLVED.has(result)) {
    throw new BadRequestError(
      "Verify the corrective action is effective before closing this nonconformity",
      "EFFECTIVENESS_NOT_VERIFIED",
    );
  }
}

/** OD `capSave` (11524): which nonconformity status a CAP's implementation status drives. */
const NC_STATUS_FROM_CAP: Record<string, string> = {
  Closed: "Closed",
  "Pending Effectiveness Check": "Pending Effectiveness Check",
  Planned: "CAP Planned",
  Effective: "Pending Effectiveness Check",
};

function deriveNcStatusFromCap(implementationStatus: string): string {
  return NC_STATUS_FROM_CAP[implementationStatus] ?? "In Progress";
}

/** OD `ipPadCAP`: CAP ids are their own per-org sequence, independent of NC codes. */
async function nextCapCode(orgId: string): Promise<string> {
  const rows = await ImplementationRecord.findAll({ where: { module: "nonconformities", orgId } });
  let max = 0;
  for (const row of rows) {
    const cap = (row.data as Record<string, unknown> | null)?.cap as Record<string, unknown> | undefined;
    const id = cap?.id as string | undefined;
    const n = id ? Number.parseInt(id.replace(/^CAP-/, ""), 10) : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `CAP-${String(max + 1).padStart(4, "0")}`;
}

/**
 * OD `capSave` (11524): saving a nonconformity's corrective action plan
 * assigns the CAP its own code the first time one is created, and — only
 * when the CAP's `implementationStatus` actually changed in this update —
 * derives the nonconformity's own status and copies the CAP's PIC/Due up onto
 * it. Scoping the derivation to an actual implementation-status change (not
 * every save that happens to carry an unchanged `data.cap`) keeps a plain
 * "Edit NC" that leaves the CAP alone from re-deriving the status underneath
 * an explicit manual choice, while a genuine CAP status edit — from any
 * client — can never leave the two lifecycles in contradiction.
 */
async function applyCapSideEffects(module: string, orgId: string, r: ImplementationRecord, input: RecordInput): Promise<void> {
  if (module !== "nonconformities" || input.data === undefined) return;
  const data = input.data as Record<string, unknown>;
  const cap = data.cap as Record<string, unknown> | null | undefined;
  if (!cap) return;
  const existingCap = ((r.data ?? {}) as Record<string, unknown>).cap as Record<string, unknown> | undefined | null;

  const nextCap: Record<string, unknown> = { ...cap };
  if (!nextCap.id) nextCap.id = existingCap?.id ?? (await nextCapCode(orgId));
  data.cap = nextCap;

  const prevImpl = existingCap?.implementationStatus as string | undefined;
  const nextImpl = nextCap.implementationStatus as string | undefined;
  data.capStatus = nextImpl ?? existingCap?.implementationStatus ?? null;
  if (nextImpl && nextImpl !== prevImpl) {
    input.status = deriveNcStatusFromCap(nextImpl);
    data.pic = nextCap.pic ?? data.pic;
    data.due = nextCap.due ?? data.due;
  }
  input.data = data;
}

/**
 * OD's Training Plan closes the loop: recording a completed training whose
 * reassessment outcome is "Meets Requirement" resolves the competence gap that
 * prompted it, rather than leaving the two records to drift apart.
 */
async function closeLinkedGap(auth: AuthContext, r: ImplementationRecord, ip: string | null): Promise<void> {
  const data = (r.data ?? {}) as { gapId?: string; outcome?: string };
  if (!data.gapId || data.outcome !== "Meets Requirement") return;

  const gap = await CompetenceGap.findByPk(data.gapId);
  if (!gap || gap.orgId !== r.orgId) return;

  const today = new Date().toISOString().slice(0, 10);
  gap.trainingDone = true;
  gap.trainingDate = today;
  gap.status = "Resolved";
  gap.resolvedDate = today;
  await gap.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: "competence.gap.closedByTraining", entityType: "CompetenceGap", entityId: gap.id,
    sourceIp: ip, result: "Success", metadata: { trainingRecordId: r.id },
  });
  await logActivity(auth, r.orgId, r.module, r.id, `Closed competence gap ${gap.code}`);
}

/**
 * OD `awTopicActivate`: an awareness topic cannot go live until it has at
 * least one uploaded material. The whole point of the gate is evidence — an
 * "Active" topic with nothing to show is exactly what an auditor would flag.
 * Toggleable via the org's awareness settings (`requireMaterial`, OD
 * `awSettings` 14240); only non-archived / non-superseded materials count.
 */
async function assertActivatable(module: string, orgId: string, existingData: Record<string, unknown>, nextStatus: string | undefined, input: RecordInput): Promise<void> {
  if (module !== "awareness-topics" || nextStatus !== "Active") return;
  const settings = await getAwSettings(orgId);
  if (!settings.requireMaterial) return;
  if (!topicHasMaterial({ ...existingData, ...(input.data ?? {}) })) {
    throw new BadRequestError(
      "An awareness topic requires at least one material before it can be activated",
      "MATERIAL_REQUIRED",
    );
  }
}

/**
 * OD `ocDismiss` / `ocArchiveDirect`: dismissing an issue only makes sense
 * while it's still Open, and the direct-archive shortcut only applies to a
 * Monitored issue with no risk raised against it (a risk-linked issue is
 * archived by closing out its last risk instead — see the LINKED_RISK_OPEN
 * check below). Both transitions require a typed justification, stamped with
 * who did it and when, and stored on the record so it can be shown in its
 * history. Back-compat: a generic `data.justification` (pre-dating the
 * dismiss/archive-specific fields) is still accepted as the justification text.
 */
async function assertArchivable(
  auth: AuthContext, module: string, r: ImplementationRecord, nextStatus: string | undefined, input: RecordInput,
): Promise<Record<string, unknown> | undefined> {
  if (module !== "context") return undefined;
  if (nextStatus !== "Archived" && nextStatus !== "Dismissed") return undefined;
  if (nextStatus === r.status) return undefined; // not a transition — nothing new to validate or stamp

  if (nextStatus === "Dismissed" && r.status !== "Open") {
    throw new BadRequestError("Only open issues can be dismissed", "INVALID_TRANSITION");
  }
  if (nextStatus === "Archived" && r.status !== "Monitored") {
    throw new BadRequestError("Only monitored issues can be archived here", "INVALID_TRANSITION");
  }

  const existing = (r.data ?? {}) as Record<string, unknown>;
  const provided = (input.data ?? {}) as Record<string, unknown>;
  const specificKey = nextStatus === "Archived" ? "archiveJustification" : "dismissJustification";
  const justification = (
    provided[specificKey] ?? provided.justification ?? existing[specificKey] ?? existing.justification
  ) as string | undefined;
  if (!justification || !justification.trim()) {
    throw new BadRequestError(
      `A justification is required to ${nextStatus === "Archived" ? "archive" : "dismiss"} a context issue`,
      "JUSTIFICATION_REQUIRED",
    );
  }

  if (nextStatus === "Archived") {
    const riskId = existing.raisedRiskId as string | undefined;
    if (riskId) {
      const risk = await ImplementationRecord.findOne({ where: { id: riskId, orgId: r.orgId } });
      if (risk && risk.module === "risks" && !["Monitored", "Archived"].includes(risk.status)) {
        throw new BadRequestError(
          `Cannot archive: linked risk ${risk.code} still has an open treatment`,
          "LINKED_RISK_OPEN",
        );
      }
    }
  }

  const now = new Date().toISOString();
  const who = await actorName(auth);
  return nextStatus === "Archived"
    ? { archiveJustification: justification.trim(), archivedBy: who, archivedAt: now }
    : { dismissJustification: justification.trim(), dismissedBy: who, dismissedAt: now };
}

/**
 * OD `riskArchive` (index.html:8135–8137): a risk can only be archived once
 * it has reached "Monitored" — every other status must run its assessment /
 * treatment through first. Re-archiving an already-archived risk is refused
 * too, exactly as OD's own guard does (it checks `r.status==='Archived'`
 * unconditionally, before checking whether anything would actually change).
 */
function assertRiskArchivable(module: string, r: ImplementationRecord, nextStatus: string | undefined): void {
  if (module !== "risks" || nextStatus !== "Archived") return;
  if (r.status === "Archived") {
    throw new BadRequestError("Risk already archived", "RISK_ALREADY_ARCHIVED");
  }
  if (r.status !== "Monitored") {
    throw new BadRequestError('Risk must reach "Monitored" before it can be archived.', "INVALID_TRANSITION");
  }
}

export async function updateRecord(auth: AuthContext, module: string, id: string, input: RecordInput, ip: string | null): Promise<RecordView> {
  const r = await requireRecord(auth, module, id);
  // External documents/folders: the bespoke flows (edit metadata, upload new
  // version, record review, status set, folder edit/archive) pass an OD-style
  // activity line (`ocLogAdd`) via the transient `data._activityNote` key —
  // it is logged to the record's activity feed, never stored in the data bag.
  let extActivityNote: string | undefined;
  if ((module === "records" || module === "record-folders") && input.data && typeof input.data._activityNote === "string") {
    extActivityNote = input.data._activityNote;
    const rest = { ...input.data };
    delete rest._activityNote;
    input = { ...input, data: rest };
  }
  // Runs before assertClosable: a CAP-driven derivation can itself resolve to
  // `input.status = "Closed"` (e.g. the CAP's own implementation status is set
  // to Closed), and that derived close must pass the same effectiveness gate
  // as an explicit one — see `applyCapSideEffects`.
  await applyCapSideEffects(module, r.orgId, r, input);
  assertClosable(module, r, input.status, input);
  await assertActivatable(module, r.orgId, (r.data ?? {}) as Record<string, unknown>, input.status, input);
  assertRiskArchivable(module, r, input.status);
  const archiveStamp = await assertArchivable(auth, module, r, input.status, input);
  // OD `tpSave`: source/type/delivery must come from the Training Plan
  // vocabulary — validated against the merged (existing + incoming) shape so
  // a partial edit that doesn't touch these fields can't be tripped up by
  // stale data written before the vocabulary existed.
  if (module === "training" && input.data !== undefined) {
    assertTrainingVocab({ ...(r.data ?? {}), ...input.data });
  }

  // Controlled documents: settings-gated saves, derived next review, and
  // version-forking instead of overwriting once published (OD `cdSave`).
  // A request without `data` is a pure status transition (OD `cdSet`) and
  // bypasses the save gates entirely, exactly like OD.
  if (module === "documents" && input.data !== undefined) {
    const settings = await getDocSettings(r.orgId);
    const existing = (r.data ?? {}) as Record<string, unknown>;
    const mergedData = { ...existing, ...(input.data ?? {}) };
    assertDocumentSaveGates(settings, {
      owner: input.owner !== undefined ? input.owner : r.owner,
      approver: mergedData.approver,
      changeSummary: mergedData.changeSummary,
    });
    if (input.data !== undefined) input = { ...input, data: deriveDocumentData(input.data) };
    if (r.status === "Published" && input.status === undefined && !settings.allowEditPublished) {
      return forkPublishedRecord(auth, r, input, ip, DOCUMENT_FORK);
    }
  }

  // Policies: OD `polSave` (10847) — editing a Published policy never edits it
  // in place. It forks a new Draft (v+1, same lineage, cleared approval/publish
  // stamps); the original stays Published until the new version itself
  // publishes (supersede happens in `publishWithLineage`). A pure status
  // transition (Published → Archived) is not an edit and passes through.
  if (module === "policies" && input.data !== undefined) {
    if (r.status === "Published" && input.status === undefined) {
      return forkPublishedRecord(auth, r, input, ip, POLICY_FORK);
    }
    input = { ...input, data: derivePolicyData(input.data) };
  }

  // Management Reviews: the registry's `deep: true` means a status change must
  // follow the OD lifecycle graph (`mrMenu` 10985–11000) — Draft → Finalized
  // and similar jumps are rejected here regardless of client. Finalize stamps
  // finalizedBy/finalizedDate (`mrFinalize` 10996); Cancel demands a typed
  // reason (`mrCancel` 10997); schedule edits must keep a date + time
  // (`mrSave` 11124–11126); new agenda topics get org-wide `MRI-####` ids.
  let reviewStamp: Record<string, unknown> | undefined;
  if (module === "reviews" && MS_MODULES[module].deep) {
    const nextStatus = input.status ?? r.status;
    if (input.status !== undefined && input.status !== r.status) {
      assertReviewTransition(r.status, input.status);
      reviewStamp = reviewTransitionStamp(
        input.status, input.data ?? {}, (r.data ?? {}) as Record<string, unknown>,
        (await actorName(auth)) ?? "Unknown user", new Date().toISOString(),
      );
    }
    if (input.data !== undefined) {
      // A cancel/archive carrying data (the typed reason) is exempt from the
      // schedule requirement — OD lets you cancel a review whose schedule was
      // never completed.
      if (!["Cancelled", "Archived"].includes(nextStatus)) assertReviewSchedule(input.data);
      input = { ...input, data: await assignReviewTopicIds(r.orgId, input.data) };
    }
  }

  const statusChanged = input.status !== undefined && input.status !== r.status;
  const prevStatus = r.status;
  if (input.title !== undefined) r.title = input.title.trim();
  if (input.status !== undefined) {
    assertStatus(module, input.status);
    r.status = input.status;
  }
  if (input.owner !== undefined) r.owner = input.owner;
  if (input.data !== undefined || archiveStamp || reviewStamp) {
    r.data = enrichData(module, { ...(input.data ?? r.data ?? {}), ...(archiveStamp ?? {}), ...(reviewStamp ?? {}) });
  }
  if (input.elementId !== undefined) r.elementId = input.elementId;
  if (input.frameworks !== undefined) r.frameworks = input.frameworks;
  await r.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.${module}.updated`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  // Surface the justification straight in the activity feed — the generic
  // RecordEventsPanel timeline renders this text verbatim, so this is the
  // simplest way to make a Dismiss/Archive reason visible without a dedicated UI.
  const justificationText = archiveStamp
    ? ((archiveStamp.archiveJustification ?? archiveStamp.dismissJustification) as string)
    : typeof reviewStamp?.cancelReason === "string"
      ? reviewStamp.cancelReason
      : undefined;
  await logActivity(
    auth, r.orgId, module, r.id,
    extActivityNote
      ?? (justificationText
        ? `Status changed: ${prevStatus} → ${r.status} — ${justificationText}`
        : statusChanged ? `Status changed: ${prevStatus} → ${r.status}` : "Record updated"),
  );
  // Only the *transition* into Completed closes the gap. Firing on every save
  // while already Completed would re-stamp the gap's resolution dates to today
  // and duplicate its audit trail on any unrelated field edit.
  if (module === "training" && statusChanged && r.status === "Completed") await closeLinkedGap(auth, r, ip);
  return decorateForModule(module, view(r));
}

export async function deleteRecord(auth: AuthContext, module: string, id: string, ip: string | null): Promise<void> {
  // OD offers no hard delete for controlled documents — Archive is the soft
  // terminal state (cdMenu 12825–12834). Enforced here so no client can bypass it.
  if (module === "documents") {
    throw new BadRequestError("Controlled documents are archived, never deleted", "DOC_DELETE_FORBIDDEN");
  }
  // OD offers no hard delete for policies either — polMenu (10297–10305) ends
  // at Archive; version lineage must survive supersede chains.
  if (module === "policies") {
    throw new BadRequestError("Policies are archived, never deleted", "POLICY_DELETE_FORBIDDEN");
  }
  // OD offers no hard delete for external documents either — edDocMenu
  // (13210–13220) ends at Archive; the FE never exposes a delete action, but
  // the API route was still reachable directly (certification audit finding).
  if (module === "records") {
    throw new BadRequestError("External documents are archived, never deleted", "RECORD_DELETE_FORBIDDEN");
  }
  const r = await requireRecord(auth, module, id);
  // OD `edFolderDelete` (13153): a folder that still holds documents cannot be
  // hard-deleted — move or remove them first. Enforced server-side so no client
  // can orphan external documents.
  if (module === "record-folders") {
    const count = await folderDocumentCount(r.orgId, r.id);
    if (count > 0) {
      throw new BadRequestError(
        `Folder is not empty — move or remove its ${count} document${count === 1 ? "" : "s"} first`,
        "FOLDER_NOT_EMPTY",
      );
    }
  }
  const orgId = r.orgId;
  await r.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: `ms.${module}.deleted`, entityType: "ImplementationRecord", entityId: id, sourceIp: ip, result: "Success",
  });
}

/** OD `CON_CLASS` — the six outcomes a reviewed concern can be classified as. */
export const CONCERN_CLASSIFICATIONS = [
  "Nonconformity", "Incident", "Observation / Improvement",
  "No Action Required", "Duplicate", "Invalid Report",
] as const;
export type ConcernClassification = (typeof CONCERN_CLASSIFICATIONS)[number];

/** Which register each routable classification creates a record in. */
const ROUTE_TARGET: Partial<Record<ConcernClassification, string>> = {
  Nonconformity: "nonconformities",
  Incident: "incidents",
  "Observation / Improvement": "improvements",
};

export interface ConcernRouteInput {
  reviewer: string;
  classification: string;
  reviewNotes?: string;
  routingNotes?: string;
  relatedExisting?: string;
  closureReason?: string;
}

/**
 * OD `conRoute`: reviewing a concern is not a status edit — classifying it as a
 * Nonconformity/Incident/Improvement *creates* that record, carrying the
 * concern's context across and cross-linking both ways. Duplicate/No-Action/
 * Invalid close the concern instead, and require a stated reason. Without this
 * the intake register is a dead end: you can log a concern but never act on it.
 */
export async function routeConcern(
  auth: AuthContext, id: string, input: ConcernRouteInput, ip: string | null,
): Promise<{ concern: RecordView; created: RecordView | null }> {
  const c = await requireRecord(auth, "concerns", id);
  if (c.status === "Routed" || c.status === "Closed") {
    throw new BadRequestError("This concern has already been reviewed", "CONCERN_ALREADY_ROUTED");
  }

  const reviewer = input.reviewer?.trim();
  if (!reviewer) throw new BadRequestError("Reviewer is required", "REVIEWER_REQUIRED");

  const cl = input.classification as ConcernClassification;
  if (!CONCERN_CLASSIFICATIONS.includes(cl)) {
    throw new BadRequestError("Invalid classification", "INVALID_CLASSIFICATION");
  }

  const reviewNotes = input.reviewNotes?.trim() ?? "";
  const routingNotes = input.routingNotes?.trim() ?? "";
  if (!reviewNotes && !routingNotes) {
    throw new BadRequestError("Add review or routing notes", "NOTES_REQUIRED");
  }

  const src = (c.data ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  let created: ImplementationRecord | null = null;
  const target = ROUTE_TARGET[cl];

  if (target) {
    created = await ImplementationRecord.create({
      orgId: c.orgId,
      module: target,
      code: await nextCode(target, c.orgId),
      title: c.title,
      status: "Open",
      owner: c.owner,
      frameworks: c.frameworks ?? [],
      elementId: c.elementId,
      data: enrichData(target, {
        sourceConcernId: c.id,
        sourceConcernCode: c.code,
        description: src.description ?? "",
        process: src.process ?? "",
        site: src.site ?? "",
        workUnit: src.workUnit ?? "",
        evidence: src.evidence ?? "",
        confirmedBy: reviewer,
        confirmedDate: now,
        // OD `conRoute` (11365): a concern routed to Nonconformity always
        // starts as a "Process Nonconformity" with no CAP and no PIC/Due yet
        // — the reviewer sets the real category via `ncForm`, and the CAP
        // editor supplies PIC/Due once a corrective action plan exists.
        ...(target === "nonconformities" ? { category: "Process Nonconformity", pic: "", due: "", cap: null } : {}),
      }),
    });
    c.status = "Routed";
    c.data = { ...src, reviewer, reviewDate: now, reviewNotes, routingNotes,
      classification: cl, routedTo: target, routedRecordId: created.id, routedRecordCode: created.code };
  } else if (cl === "Duplicate") {
    const dup = input.relatedExisting?.trim();
    if (!dup) throw new BadRequestError("Related existing record is required", "RELATED_RECORD_REQUIRED");
    c.status = "Closed";
    c.data = { ...src, reviewer, reviewDate: now, reviewNotes, routingNotes,
      classification: cl, relatedExisting: dup, closureReason: `Duplicate of ${dup}` };
  } else {
    const reason = input.closureReason?.trim();
    if (!reason) throw new BadRequestError("Closure reason is required", "CLOSURE_REASON_REQUIRED");
    c.status = "Closed";
    c.data = { ...src, reviewer, reviewDate: now, reviewNotes, routingNotes,
      classification: cl, closureReason: reason };
  }
  await c.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: c.orgId,
    action: "ms.concerns.routed", entityType: "ImplementationRecord", entityId: c.id,
    sourceIp: ip, result: "Success", metadata: { classification: cl, createdId: created?.id ?? null },
  });
  await logActivity(auth, c.orgId, "concerns", c.id,
    created ? `Routed to ${created.code}` : `Closed — ${cl}`);
  if (created) {
    await logActivity(auth, c.orgId, target!, created.id, `Created from concern ${c.code}`);
  }

  return { concern: view(c), created: created ? view(created) : null };
}
