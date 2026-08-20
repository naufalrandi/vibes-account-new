/**
 * Training Plan lifecycle — OD's `tp*` helpers, server-side (index.html
 * 13932–14225, "Training Plan (tenant · Personnel · FWE-010)").
 *
 * The register itself lives in `implementation_records` (module `training`,
 * registry.ts `training`, prefix "TP"); this module owns everything that
 * doesn't fit the generic create/update path:
 *
 *  - the derived Overdue status (`tpOverdue`/`tpEffStatus`, 13944–13945) —
 *    computed on every read, never persisted as a stored status;
 *  - the write-time vocabulary gate on `source`/`type`/`delivery`
 *    (`assertTrainingVocab`, mirrors `tpSave`'s dropdowns);
 *  - the three lifecycle actions the OD menu exposes beyond a plain field
 *    edit (`tpMenu` 14083–14089): Record Completion (`tpComplete` /
 *    `tpCompleteSave` 14162–14179), Reassessment (`tpReassess` /
 *    `tpReassessSave` 14180–14193), and Close (`tpSet(id,'Closed')`
 *    14090–14092) — each of which mirrors the OD activity wording
 *    (`ocLogAdd`) and cascades onto the linked competence gap the way OD
 *    does.
 *
 * Gap-cascade side effects (binding a new plan to its source gap, recording a
 * reassessment result onto the gap, resolving the gap when its plan closes)
 * are delegated to the competence module's own exported functions
 * (`bindGapToNewTrainingPlan` / `recordGapReassessment` /
 * `resolveGapFromTrainingPlanClosed`, competence.assessment.service.ts) —
 * they own the `CompetenceGap` row, carry OD's exact `ocLogAdd` activity
 * wording for the gap side, and persist `reassessResult`/`trainingPlanId` on
 * columns that module added (migration 0054). A missing/foreign gapId is
 * swallowed here the same way OD's `ngById(gapId)` silently returns
 * undefined for a stale reference, rather than failing the whole action.
 */
import { ImplementationRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { logActivity, actorName } from "../record-events/recordEvent.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { TP_SOURCES, TP_TYPES, TP_DELIVERY } from "./registry";
import {
  bindGapToNewTrainingPlan, recordGapReassessment, resolveGapFromTrainingPlanClosed,
} from "../competence/competence.assessment.service";

/** OD's `ngById(gapId)` returns `undefined` for a stale/foreign reference and
 * every call site just skips the gap-side cascade — mirrored here by
 * swallowing the gap-service's `NotFoundError` (any other error, e.g. a
 * cross-org `ForbiddenError`, still surfaces). */
async function withOptionalGap(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
}

/** OD `tpReassessSave`'s dropdown (index.html:14184) — a separate 3-value vocabulary from TP_RESULTS. */
export const TP_REASSESS_RESULTS = ["Meets Requirement", "Partially Meets", "Does Not Meet"] as const;

const TERMINAL_STATUSES = ["Completed", "Closed", "Cancelled"];

/** OD `tpOverdue` (13944): due date passed and the item hasn't reached a terminal status. */
export function trainingOverdue(due: unknown, status: string): boolean {
  if (typeof due !== "string" || !due) return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now() && !TERMINAL_STATUSES.includes(status);
}

/** OD `tpEffStatus` (13945): the derived display status. Never persisted as `status`. */
export function trainingEffectiveStatus(due: unknown, status: string): string {
  return trainingOverdue(due, status) ? "Overdue" : status;
}

/** Injects the derived `overdue`/`effectiveStatus` fields OD computes on every render (never stored). */
export function decorateTrainingView<T extends { status: string; data: Record<string, unknown> }>(v: T): T {
  const overdue = trainingOverdue(v.data.due, v.status);
  return { ...v, data: { ...v.data, overdue, effectiveStatus: overdue ? "Overdue" : v.status } };
}

/** OD `tpForm`/`tpSave`: source/type/delivery must come from the registry vocabulary when supplied. */
export function assertTrainingVocab(data: Record<string, unknown>): void {
  if (data.source !== undefined && data.source !== "" && !(TP_SOURCES as readonly string[]).includes(String(data.source))) {
    throw new BadRequestError(`Invalid training source "${String(data.source)}"`, "INVALID_TRAINING_SOURCE");
  }
  if (data.type !== undefined && data.type !== "" && !(TP_TYPES as readonly string[]).includes(String(data.type))) {
    throw new BadRequestError(`Invalid training type "${String(data.type)}"`, "INVALID_TRAINING_TYPE");
  }
  if (data.delivery !== undefined && data.delivery !== "" && !(TP_DELIVERY as readonly string[]).includes(String(data.delivery))) {
    throw new BadRequestError(`Invalid training delivery method "${String(data.delivery)}"`, "INVALID_TRAINING_DELIVERY");
  }
}

export interface TrainingRecordView {
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

function view(r: ImplementationRecord): TrainingRecordView {
  return {
    id: r.id, orgId: r.orgId, module: r.module, code: r.code, title: r.title, status: r.status,
    owner: r.owner, data: r.data ?? {}, elementId: r.elementId, frameworks: r.frameworks ?? [],
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

async function requireTraining(auth: AuthContext, id: string): Promise<ImplementationRecord> {
  const r = await ImplementationRecord.findOne({ where: { id, module: "training" } });
  if (!r) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(r.orgId)) throw new ForbiddenError();
  return r;
}

// --- Record Completion (OD `tpComplete` / `tpCompleteSave` 14162–14179) ----

export interface CompleteTrainingInput {
  completionDate?: string;
  completionResult?: string;
  completedBy?: string[] | string;
  evidence?: string;
  notes?: string;
}

/**
 * OD `tpCompleteSave`: records the completion outcome. The status rule is
 * NOT a simple "reassessRequired ? Pending Reassessment : Completed" — a
 * non-"Completed" result (Partially Completed / Not Completed / Failed /
 * Waived) always lands the item on "Completed" regardless of
 * `reassessRequired`. That looks like an OD quirk; it is reproduced exactly.
 */
export async function completeTraining(
  auth: AuthContext, id: string, input: CompleteTrainingInput, ip: string | null,
): Promise<TrainingRecordView> {
  const r = await requireTraining(auth, id);
  // OD `tpMenu` (14084): "Record Completion" is offered unless the item is
  // already Completed/Closed/Cancelled.
  if (TERMINAL_STATUSES.includes(r.status)) {
    throw new BadRequestError("This training plan item is already closed out", "TRAINING_ALREADY_CLOSED");
  }
  const who = (await actorName(auth)) ?? "Unknown user";
  const now = new Date().toISOString();
  const data = { ...(r.data ?? {}) } as Record<string, unknown>;

  const completionDate = input.completionDate ? new Date(input.completionDate).toISOString() : now;
  const completionResult = input.completionResult || "Completed";
  const completedBy = Array.isArray(input.completedBy)
    ? input.completedBy.map((s) => String(s).trim()).filter(Boolean)
    : String(input.completedBy ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const evidence = (input.evidence ?? "").trim();
  const notes = (input.notes ?? "").trim();

  data.completionDate = completionDate;
  data.completionResult = completionResult;
  data.completedBy = completedBy;
  data.completionEvidence = evidence;
  data.completionNotes = notes;
  data.lastUpdatedBy = who;

  const reassessRequired = Boolean(data.reassessRequired);
  r.status = completionResult === "Completed" ? (reassessRequired ? "Pending Reassessment" : "Completed") : "Completed";
  r.data = data;
  await r.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: "ms.training.completed", entityType: "ImplementationRecord", entityId: r.id,
    sourceIp: ip, result: "Success", metadata: { completionResult },
  });
  // OD `ocLogAdd(x,'uploaded completion evidence',...)` fires as a separate
  // line BEFORE the completion line, only when evidence was supplied.
  if (evidence) {
    await logActivity(auth, r.orgId, "training", r.id, `Uploaded completion evidence — ${evidence}`);
  }
  const pendingNote = reassessRequired && completionResult === "Completed" ? " · pending reassessment" : "";
  await logActivity(auth, r.orgId, "training", r.id, `Recorded completion — ${completionResult}${pendingNote}`);

  return decorateTrainingView(view(r));
}

// --- Reassessment (OD `tpReassess` / `tpReassessSave` 14180–14193) ---------

export interface ReassessTrainingInput {
  result: string;
  notes?: string;
}

export interface ReassessTrainingResult {
  training: TrainingRecordView;
  message: string;
}

/**
 * OD `tpReassessSave`: records the reassessment outcome. "Meets Requirement"
 * closes both the training item and its linked competence gap; either other
 * result sends the item back to "Pending Reassessment" and reopens the gap.
 */
export async function reassessTraining(
  auth: AuthContext, id: string, input: ReassessTrainingInput, ip: string | null,
): Promise<ReassessTrainingResult> {
  const r = await requireTraining(auth, id);
  const result = input.result;
  if (!result || !(TP_REASSESS_RESULTS as readonly string[]).includes(result)) {
    throw new BadRequestError(
      `Reassessment result must be one of ${TP_REASSESS_RESULTS.join(", ")}`, "INVALID_REASSESS_RESULT",
    );
  }
  const who = (await actorName(auth)) ?? "Unknown user";
  const data = { ...(r.data ?? {}) } as Record<string, unknown> & { gapId?: string };
  data.reassessResult = result;
  data.lastUpdatedBy = who;

  const meets = result === "Meets Requirement";
  r.status = meets ? "Closed" : "Pending Reassessment";
  r.data = data;
  await r.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: "ms.training.reassessed", entityType: "ImplementationRecord", entityId: r.id,
    sourceIp: ip, result: "Success", metadata: { result },
  });
  await logActivity(auth, r.orgId, "training", r.id, `Reassessment completed — ${result}`);

  // OD's toast ("Requirement met — gap & training closed" / "Reassessment
  // saved — gap remains open") is keyed on `res` alone — it fires even when
  // there's no linked gap at all; the gap-side cascade below is the part
  // that's actually conditional on `gp` existing.
  const message = meets ? "Requirement met — gap & training closed" : "Reassessment saved — gap remains open";
  if (typeof data.gapId === "string" && data.gapId) {
    const gapId = data.gapId;
    await withOptionalGap(() => recordGapReassessment(auth, gapId, result, r.code, ip));
  }

  return { training: decorateTrainingView(view(r)), message };
}

// --- Close / Cancel (OD `tpSet(id, st)` 14090–14092) ------------------------

const TP_SETTABLE = ["Closed", "Cancelled"] as const;
export type TrainingSettableStatus = (typeof TP_SETTABLE)[number];

/**
 * OD `tpSet`: a plain status flip to Closed or Cancelled — the only two
 * transitions the OD menu drives outside the edit form. Closing a
 * gap-linked item that isn't already Resolved cascades the gap to Resolved,
 * exactly as OD's `tpSet` does inline.
 */
export async function setTrainingStatus(
  auth: AuthContext, id: string, status: string, ip: string | null,
): Promise<TrainingRecordView> {
  if (!(TP_SETTABLE as readonly string[]).includes(status)) {
    throw new BadRequestError(
      `Training plan status can only be set to ${TP_SETTABLE.join(" or ")} here`, "INVALID_TRAINING_STATUS_SET",
    );
  }
  const r = await requireTraining(auth, id);
  const who = (await actorName(auth)) ?? "Unknown user";
  const data = { ...(r.data ?? {}) } as Record<string, unknown> & { gapId?: string };
  data.lastUpdatedBy = who;
  r.status = status;
  r.data = data;
  await r.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.training.${status.toLowerCase()}`, entityType: "ImplementationRecord", entityId: r.id,
    sourceIp: ip, result: "Success",
  });
  const verb = status === "Closed" ? "Closed the training plan" : "Cancelled the training plan";
  await logActivity(auth, r.orgId, "training", r.id, `${verb} — Status → ${status}`);

  if (status === "Closed" && typeof data.gapId === "string" && data.gapId) {
    const gapId = data.gapId;
    // `resolveGapFromTrainingPlanClosed` already guards `status !== "Resolved"`
    // internally (OD `gp.status!=='Resolved'`), so no idempotency check here.
    await withOptionalGap(() => resolveGapFromTrainingPlanClosed(auth, gapId, r.code, ip));
  }

  return decorateTrainingView(view(r));
}

// --- Create-time gap binding (OD `tpSave` create path, index.html:14157) ---

/**
 * OD `tpSave`: creating a NEW training plan bound to a competence gap
 * (`src==='Competence Gap'`) sets `gap.trainingPlanId` and moves an Open gap
 * to Planned, cross-linking the two records the moment the plan exists —
 * without this the gap's disposition badge would read "Training Plan
 * Required" forever even after a plan was created for it. Called by
 * `createRecord` right after the training row itself is created.
 */
export async function bindTrainingRecordToGap(
  auth: AuthContext, gapId: string, trainingCode: string, ip: string | null,
): Promise<void> {
  await withOptionalGap(() => bindGapToNewTrainingPlan(auth, gapId, trainingCode, ip));
}
