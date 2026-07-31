import { Op, type WhereOptions } from "sequelize";
import { CompetenceGap, ImplementationRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { MS_MODULES, isMsModule, enrichData } from "./registry";
import { logActivity } from "../record-events/recordEvent.service";

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

function view(r: ImplementationRecord): RecordView {
  return {
    id: r.id, orgId: r.orgId, module: r.module, code: r.code, title: r.title,
    status: r.status, owner: r.owner, data: r.data ?? {}, elementId: r.elementId,
    frameworks: r.frameworks ?? [], createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function requireModule(module: string) {
  if (!isMsModule(module)) throw new NotFoundError("Unknown register module", "MODULE_NOT_FOUND");
  return MS_MODULES[module];
}

function assertStatus(module: string, status: string) {
  const def = MS_MODULES[module];
  if (!def.statuses.includes(status)) {
    throw new BadRequestError(`Invalid status "${status}" for ${module}`, "INVALID_STATUS");
  }
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function nextCode(module: string): Promise<string> {
  const { prefix } = MS_MODULES[module];
  const rows = await ImplementationRecord.findAll({ where: { module }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
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
  const rows = await ImplementationRecord.findAll({ where, order: [["createdAt", "DESC"]] });
  return rows.map(view);
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
  const status = input.status ?? def.statuses[0];
  assertStatus(module, status);
  const r = await ImplementationRecord.create({
    orgId: targetOrg,
    module,
    code: await nextCode(module),
    title: input.title.trim(),
    status,
    owner: input.owner ?? null,
    data: enrichData(module, input.data ?? {}),
    elementId: input.elementId ?? null,
    frameworks: input.frameworks ?? [],
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: targetOrg,
    action: `ms.${module}.created`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  await logActivity(auth, targetOrg, module, r.id, "Record created");
  return view(r);
}

/** Bump a dotted document version the way OD does: 1.0 → 1.1, blank → 1.0. */
function nextVersion(current: unknown): string {
  const n = Number.parseFloat(String(current ?? ""));
  return Number.isFinite(n) ? (n + 0.1).toFixed(1) : "1.0";
}

/**
 * OD `cdSave`: editing an already-published controlled document does not mutate
 * it in place — it forks a new Draft at the next version, links the two, and
 * supersedes the original, so the approved text stays intact and auditable.
 * A pure status transition (e.g. Active → Archived) is not an edit and passes
 * straight through.
 */
async function forkPublishedDocument(
  auth: AuthContext, r: ImplementationRecord, input: RecordInput, ip: string | null,
): Promise<RecordView> {
  const data = { ...(r.data ?? {}) , ...(input.data ?? {}) };
  data.version = nextVersion((r.data ?? {}).version);
  data.supersedes = r.id;

  const draft = await ImplementationRecord.create({
    orgId: r.orgId,
    module: r.module,
    code: await nextCode(r.module),
    title: input.title?.trim() ?? r.title,
    status: "Draft",
    owner: input.owner !== undefined ? input.owner : r.owner,
    data: enrichData(r.module, data),
    elementId: input.elementId !== undefined ? input.elementId : r.elementId,
    frameworks: input.frameworks ?? r.frameworks,
  });

  r.status = "Superseded";
  r.data = { ...(r.data ?? {}), supersededBy: draft.id };
  await r.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.${r.module}.revised`, entityType: "ImplementationRecord", entityId: draft.id, sourceIp: ip, result: "Success",
    metadata: { supersedes: r.id, version: data.version },
  });
  await logActivity(auth, r.orgId, r.module, r.id, `Superseded by v${data.version}`);
  await logActivity(auth, r.orgId, r.module, draft.id, `New draft v${data.version} from ${r.code}`);
  return view(draft);
}

/**
 * OD `ncClose`: a nonconformity cannot be closed until its corrective action has
 * been verified effective. Enforced server-side so the gate holds regardless of
 * which client performs the transition.
 */
function assertClosable(module: string, r: ImplementationRecord, nextStatus: string | undefined, input: RecordInput): void {
  if (module !== "nonconformities" || nextStatus !== "Closed") return;
  const effectiveness = (input.data?.effectiveness ?? (r.data ?? {}).effectiveness) as string | undefined;
  if (effectiveness !== "Effective") {
    throw new BadRequestError(
      "Verify the corrective action is effective before closing this nonconformity",
      "EFFECTIVENESS_NOT_VERIFIED",
    );
  }
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
  gap.status = "Closed";
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
 */
function assertActivatable(module: string, r: ImplementationRecord, nextStatus: string | undefined, input: RecordInput): void {
  if (module !== "awareness-topics" || nextStatus !== "Active") return;
  const materials = (input.data?.materials ?? (r.data ?? {}).materials) as unknown[] | undefined;
  if (!Array.isArray(materials) || materials.length === 0) {
    throw new BadRequestError(
      "An awareness topic requires at least one material before it can be activated",
      "MATERIAL_REQUIRED",
    );
  }
}

/**
 * OD `ocArchive` / `ocArchiveDirect`: a context issue that has been raised as a
 * risk cannot be archived while that risk is still being treated — otherwise
 * the issue disappears from the register while its risk stays open. Dismissing
 * or archiving also requires a typed justification, which is stored on the
 * record and shown in its history.
 */
async function assertArchivable(module: string, r: ImplementationRecord, nextStatus: string | undefined, input: RecordInput): Promise<void> {
  if (module !== "context") return;
  if (nextStatus !== "Archived" && nextStatus !== "Dismissed") return;

  const justification = (input.data?.justification ?? (r.data ?? {}).justification) as string | undefined;
  if (!justification || !justification.trim()) {
    throw new BadRequestError(
      `A justification is required to ${nextStatus === "Archived" ? "archive" : "dismiss"} a context issue`,
      "JUSTIFICATION_REQUIRED",
    );
  }

  if (nextStatus !== "Archived") return;
  const riskId = (r.data ?? {}).raisedRiskId as string | undefined;
  if (!riskId) return;
  const risk = await ImplementationRecord.findByPk(riskId);
  if (risk && risk.module === "risks" && !["Monitored", "Archived"].includes(risk.status)) {
    throw new BadRequestError(
      `Cannot archive: linked risk ${risk.code} still has an open treatment`,
      "LINKED_RISK_OPEN",
    );
  }
}

export async function updateRecord(auth: AuthContext, module: string, id: string, input: RecordInput, ip: string | null): Promise<RecordView> {
  const r = await requireRecord(auth, module, id);
  assertClosable(module, r, input.status, input);
  assertActivatable(module, r, input.status, input);
  await assertArchivable(module, r, input.status, input);

  // Controlled documents are versioned rather than overwritten once published.
  const editsContent =
    input.title !== undefined || input.data !== undefined ||
    input.owner !== undefined || input.frameworks !== undefined;
  if (module === "documents" && r.status === "Published" && editsContent && input.status === undefined) {
    return forkPublishedDocument(auth, r, input, ip);
  }

  const statusChanged = input.status !== undefined && input.status !== r.status;
  const prevStatus = r.status;
  if (input.title !== undefined) r.title = input.title.trim();
  if (input.status !== undefined) {
    assertStatus(module, input.status);
    r.status = input.status;
  }
  if (input.owner !== undefined) r.owner = input.owner;
  if (input.data !== undefined) r.data = enrichData(module, input.data);
  if (input.elementId !== undefined) r.elementId = input.elementId;
  if (input.frameworks !== undefined) r.frameworks = input.frameworks;
  await r.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.${module}.updated`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  await logActivity(auth, r.orgId, module, r.id, statusChanged ? `Status changed: ${prevStatus} → ${r.status}` : "Record updated");
  // Only the *transition* into Completed closes the gap. Firing on every save
  // while already Completed would re-stamp the gap's resolution dates to today
  // and duplicate its audit trail on any unrelated field edit.
  if (module === "training" && statusChanged && r.status === "Completed") await closeLinkedGap(auth, r, ip);
  return view(r);
}

export async function deleteRecord(auth: AuthContext, module: string, id: string, ip: string | null): Promise<void> {
  const r = await requireRecord(auth, module, id);
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
      code: await nextCode(target),
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
