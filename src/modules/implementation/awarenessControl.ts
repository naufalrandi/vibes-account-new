import { Op, Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { AwarenessSettings, ImplementationRecord, RoleAssignment, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { createNotification } from "../notifications/notification.service";
import { logActivity, actorName } from "../record-events/recordEvent.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { MS_MODULES } from "./registry";

/**
 * Awareness acknowledgment / evaluation stack — the server-side half of OD's
 * `aw*` helpers (index.html:14227–14680). The three registers stay inside
 * `implementation_records` (modules `awareness` / `awareness-topics` /
 * `awareness-campaigns`); this module owns:
 *
 *  - the per-org `awSettings` singleton (OD 14240) in `awareness_settings`,
 *  - campaign launch: audience resolution (OD `awResolveAudience` 14262) +
 *    per-recipient ACK/AEV fan-out (OD `awCampDoLaunch` 14547–14552) stored as
 *    `data.acks[]` / `data.evals[]` on the campaign record,
 *  - the acknowledgment mutations (acknowledge / remind / waive — OD
 *    `awAckDo` / `awAckRemind` / `awAckWaive` 14580–14596),
 *  - the evaluation mutations (record result / follow-up action / raise a
 *    Training Plan — OD `awEvalRecord` / `awEvalFollowup` / `awEvalToTP`
 *    14622–14643),
 *  - the derived roll-ups (`ackRate` / `evalRate`, OD 14268–14269) and the
 *    Partially Completed / Overdue / Completed campaign status transitions.
 *
 * Roll-up computation design: `ackRate` / `evalRate` and the derived campaign
 * status are BOTH (a) recomputed and PERSISTED on every mutation that touches
 * the nested ledgers (launch / ack / eval endpoints — mutation-triggered
 * recompute), and (b) re-derived on every read (`decorateCampaignView`, called
 * from the register list path) so purely time-driven transitions (a campaign
 * sailing past its due date) surface without a write. The stored status is the
 * mutation-time snapshot; the served status is always the fresh derivation.
 *
 * Every nested-ledger mutation is an atomic read-modify-write: the campaign row
 * is loaded `FOR UPDATE` inside a transaction, the JSONB is copied, mutated,
 * and saved before the lock is released — two concurrent acknowledgments can
 * never clobber each other's rows.
 */

// --- Vocabulary (OD 14227–14239) ---------------------------------------------

export const AW_ACK_STMT =
  "I acknowledge that I have read and understood the awareness material and understand my responsibilities related to this topic.";
export const AW_ACK_STATUS = ["Pending", "Acknowledged", "Overdue", "Not Required", "Waived"] as const;
export const AW_EVAL_RESULTS = ["Not Evaluated", "Passed", "Failed", "Partially Passed", "Not Applicable", "Waived"] as const;
export const AW_EVAL_METHODS = [
  "Acknowledgment only", "Quiz", "Survey", "Manager confirmation", "Interview",
  "Practical scenario", "Observation", "Random check", "Self-declaration", "Other",
] as const;
export const AW_AUDIENCE_TYPES = ["All Team Members", "Specific Team Members", "Roles", "Work Units"] as const;
export const AW_FOLLOWUP_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const AW_REMINDER_FREQS = ["Once before due date", "Daily after overdue", "Weekly after overdue", "Custom"] as const;

/** Ack statuses that no longer count as outstanding. */
const ACK_DONE = ["Acknowledged", "Waived", "Not Required"];
/** Eval results that count toward the evaluation rate (OD `awCampEvalRate`). */
const EVAL_RATE_DONE = ["Passed", "Partially Passed", "Waived", "Not Applicable"];

// --- Nested ledger shapes (round-tripped verbatim through JSONB) --------------

export interface AwAck {
  id: string; memberId: string; memberName: string;
  topicId: string; materialId: string;
  due: string; statement: string; status: string;
  ackDate: string; reminderDate: string;
  waiverReason: string; waivedBy: string; waivedDate: string;
}

export interface AwEval {
  id: string; memberId: string; memberName: string; topicId: string;
  method: string; result: string; score: string;
  evaluator: string; evalDate: string;
  followupRequired: boolean; followupActionId: string; trainingPlanId?: string;
  notes: string;
}

export interface AwFollowup {
  id: string; source: string; campaignId: string; campaignCode: string;
  topicId: string; memberId: string; memberName: string;
  title: string; description: string; owner: string; due: string;
  priority: string; status: string; trainingPlanId: string;
  createdBy: string; createdDate: string;
}

export interface AwAudience { type?: string; members?: string[]; roles?: string[]; workUnits?: string[] }

// --- Settings singleton (OD `awSettings` 14240) -------------------------------

export const AW_SETTINGS_DEFAULTS = {
  requireMaterial: true,
  allowLaunchNoMaterial: false,
  requireAck: true,
  requireEval: false,
  reminders: true,
  reminderFreq: "Once before due date",
};
export type AwSettings = typeof AW_SETTINGS_DEFAULTS;

/** Per-org settings with OD's defaults for any missing row/key. */
export async function getAwSettings(orgId: string): Promise<AwSettings> {
  const row = await AwarenessSettings.findOne({ where: { orgId } });
  return { ...AW_SETTINGS_DEFAULTS, ...(row?.settings ?? {}) };
}

export async function setAwSettings(auth: AuthContext, input: Record<string, unknown>, ip: string | null): Promise<AwSettings> {
  const [row] = await AwarenessSettings.findOrCreate({
    where: { orgId: auth.orgId },
    defaults: { orgId: auth.orgId, settings: {} },
  });
  const next: Record<string, boolean | string> = { ...row.settings };
  for (const key of Object.keys(AW_SETTINGS_DEFAULTS)) {
    const v = input[key];
    if (key === "reminderFreq") {
      if (v === undefined) continue;
      if (typeof v !== "string" || !(AW_REMINDER_FREQS as readonly string[]).includes(v)) {
        throw new BadRequestError("Invalid reminder frequency", "INVALID_REMINDER_FREQ");
      }
      next[key] = v;
    } else if (typeof v === "boolean") {
      next[key] = v;
    }
  }
  row.settings = next;
  await row.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId,
    action: "ms.awareness.settingsUpdated", entityType: "AwarenessSettings", entityId: row.id, sourceIp: ip, result: "Success",
  });
  return { ...AW_SETTINGS_DEFAULTS, ...next };
}

// --- Shared helpers -----------------------------------------------------------

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * A topic material still "counts" unless archived/superseded — OD
 * `awTopicActiveMats` (14257) filters `status !== 'Archived'`; the FE materials
 * panel marks replaced files `superseded: true`. Both shapes are honoured.
 */
export function topicHasMaterial(data: Record<string, unknown> | null | undefined): boolean {
  return arr<{ superseded?: unknown; status?: unknown }>(data?.materials).some(
    (m) => m?.superseded !== true && m?.status !== "Archived",
  );
}

/** OD `awAckEff` (14260): a Pending ack past its due date reads as Overdue. */
export function ackEffectiveStatus(a: Pick<AwAck, "status" | "due">, now = new Date()): string {
  if (a.status === "Pending" && a.due && new Date(a.due) < now) return "Overdue";
  return a.status;
}

/** OD `awCampAckRate` / `awCampEvalRate` (14268–14269) — null when no rows. */
export function campaignRates(data: Record<string, unknown>): { ackRate: number | null; evalRate: number | null } {
  const acks = arr<AwAck>(data.acks);
  const evals = arr<AwEval>(data.evals);
  const ackRate = acks.length ? Math.round((acks.filter((a) => a.status === "Acknowledged").length / acks.length) * 100) : null;
  const evalRate = evals.length ? Math.round((evals.filter((e) => EVAL_RATE_DONE.includes(e.result)).length / evals.length) * 100) : null;
  return { ackRate, evalRate };
}

/**
 * Derived campaign status. Only the three "running" statuses participate —
 * Draft/Scheduled/Completed(manual)/Archived are never touched:
 *  - every ack + eval complete            → Completed
 *  - past due, nothing complete           → Overdue
 *  - past due, some but not all complete  → Partially Completed
 *  - otherwise                            → Active
 * An ack is complete at Acknowledged/Waived/Not Required; an eval once its
 * result is anything but "Not Evaluated".
 */
export function deriveCampaignStatus(stored: string, data: Record<string, unknown>, now = new Date()): string {
  if (!["Active", "Overdue", "Partially Completed"].includes(stored)) return stored;
  const acks = arr<AwAck>(data.acks);
  const evals = arr<AwEval>(data.evals);
  const total = acks.length + evals.length;
  if (total === 0) return "Active";
  const pending =
    acks.filter((a) => !ACK_DONE.includes(a.status)).length +
    evals.filter((e) => (e.result || "Not Evaluated") === "Not Evaluated").length;
  if (pending === 0) return "Completed";
  const due = str(data.dueDate) || str(data.due);
  if (!due || new Date(due) >= now) return "Active";
  return pending === total ? "Overdue" : "Partially Completed";
}

/** Read-path decoration: fresh roll-ups + time-derived status on every serve. */
export function decorateCampaignView<T extends { status: string; data: Record<string, unknown> }>(v: T): T {
  const { ackRate, evalRate } = campaignRates(v.data ?? {});
  return { ...v, status: deriveCampaignStatus(v.status, v.data ?? {}), data: { ...(v.data ?? {}), ackRate, evalRate } };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function requireCampaign(auth: AuthContext, id: string, tx?: Transaction): Promise<ImplementationRecord> {
  const r = await ImplementationRecord.findOne({
    where: { id, module: "awareness-campaigns" },
    ...(tx ? { lock: tx.LOCK.UPDATE, transaction: tx } : {}),
  });
  if (!r) throw new NotFoundError("Campaign does not exist", "RECORD_NOT_FOUND");
  await assertCanSeeOrg(auth, r.orgId);
  return r;
}

/**
 * OD `awNewId` (14253): one number sequence per tenant per prefix, across all
 * campaigns — scans every campaign's nested ledgers for the highest suffix.
 */
async function nextNestedId(orgId: string, key: "acks" | "evals" | "followups", prefix: string, tx?: Transaction): Promise<number> {
  const rows = await ImplementationRecord.findAll({
    where: { orgId, module: "awareness-campaigns" }, attributes: ["data"],
    ...(tx ? { transaction: tx } : {}),
  });
  let max = 0;
  for (const r of rows) {
    for (const item of arr<{ id?: string }>((r.data ?? {})[key])) {
      if (typeof item?.id !== "string" || !item.id.startsWith(prefix)) continue;
      const n = Number.parseInt(item.id.slice(prefix.length).replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

const pad = (n: number) => String(n).padStart(4, "0");

// --- Audience resolution (OD `awResolveAudience` 14262) -----------------------

/**
 * Resolves a campaign audience to concrete recipients against the org's Active
 * users + its role assignments (which carry both roleId and workUnit):
 *  - All Team Members       → every Active user in the org
 *  - Specific Team Members  → the listed user ids
 *  - Roles                  → members holding any listed role-template id
 *  - Work Units             → members assigned into any listed work unit
 * Unknown/absent type falls back to the whole team, exactly like OD.
 */
export async function resolveAudience(orgId: string, a: AwAudience | undefined | null): Promise<{ id: string; name: string }[]> {
  const team = await User.findAll({ where: { orgId, status: "Active" }, order: [["fullName", "ASC"]] });
  const toView = (u: User) => ({ id: u.id, name: u.fullName });
  if (!a || a.type === "Specific Team Members") {
    if (!a) return team.map(toView);
    const members = arr<string>(a.members);
    return team.filter((u) => members.includes(u.id)).map(toView);
  }
  if (a.type === "Roles" || a.type === "Work Units") {
    const where =
      a.type === "Roles"
        ? { orgId, roleId: { [Op.in]: arr<string>(a.roles) } }
        : { orgId, workUnit: { [Op.in]: arr<string>(a.workUnits) } };
    const assignments = await RoleAssignment.findAll({ where });
    const ids = new Set(assignments.map((x) => x.memberId));
    return team.filter((u) => ids.has(u.id)).map(toView);
  }
  return team.map(toView);
}

// --- Campaign launch (OD `awCampLaunch` / `awCampDoLaunch` 14533–14555) -------

export interface CampaignRecordView {
  id: string; orgId: string; module: string; code: string; title: string;
  status: string; owner: string | null; data: Record<string, unknown>;
  elementId: string | null; frameworks: string[]; createdAt: Date; updatedAt: Date;
}

function view(r: ImplementationRecord): CampaignRecordView {
  return {
    id: r.id, orgId: r.orgId, module: r.module, code: r.code, title: r.title,
    status: r.status, owner: r.owner, data: r.data ?? {}, elementId: r.elementId,
    frameworks: r.frameworks ?? [], createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function launchCampaign(auth: AuthContext, id: string, ip: string | null): Promise<CampaignRecordView> {
  const result = await sequelize.transaction(async (tx) => {
    const r = await requireCampaign(auth, id, tx);
    if (!["Draft", "Scheduled"].includes(r.status)) {
      throw new BadRequestError("Only a Draft or Scheduled campaign can be launched", "INVALID_TRANSITION");
    }
    const data = { ...(r.data ?? {}) } as Record<string, unknown>;
    const topics = arr<string>(data.topics);
    if (topics.length === 0) throw new BadRequestError("Add at least one topic before launching", "TOPICS_REQUIRED");
    const due = str(data.dueDate) || str(data.due);
    if (!due) throw new BadRequestError("A due date is required to launch a campaign", "DUE_REQUIRED");

    const settings = await getAwSettings(r.orgId);
    const topicRows = await ImplementationRecord.findAll({
      where: { orgId: r.orgId, module: "awareness-topics", id: { [Op.in]: topics } }, transaction: tx,
    });
    if (topicRows.length !== topics.length) {
      throw new BadRequestError("One or more selected topics do not exist", "TOPIC_NOT_FOUND");
    }
    // OD awCampLaunch (14556): the material gate holds unless the org opted out.
    if (!settings.allowLaunchNoMaterial) {
      const noMat = topicRows.filter((tp) => !topicHasMaterial(tp.data));
      if (noMat.length > 0) {
        throw new BadRequestError(
          `Cannot launch: ${noMat.length} selected topic(s) have no uploaded material`,
          "MATERIAL_REQUIRED",
        );
      }
    }

    const audience = await resolveAudience(r.orgId, data.audience as AwAudience | undefined);
    const now = new Date().toISOString();
    const ackRequired = typeof data.ackRequired === "boolean" ? data.ackRequired : settings.requireAck;
    const evalRequired = typeof data.evalRequired === "boolean" ? data.evalRequired : settings.requireEval;
    const topic0 = topics[0] ?? "";

    // Fan-out is idempotent per member (OD awCampDoLaunch skips existing rows).
    const acks = [...arr<AwAck>(data.acks)];
    const evals = [...arr<AwEval>(data.evals)];
    if (ackRequired) {
      let seq = await nextNestedId(r.orgId, "acks", "ACK-", tx);
      for (const u of audience) {
        if (acks.some((a) => a.memberId === u.id)) continue;
        acks.push({
          id: `ACK-${pad(++seq)}`, memberId: u.id, memberName: u.name, topicId: topic0, materialId: "",
          due, statement: AW_ACK_STMT, status: "Pending", ackDate: "", reminderDate: "",
          waiverReason: "", waivedBy: "", waivedDate: "",
        });
      }
    }
    if (evalRequired) {
      let seq = await nextNestedId(r.orgId, "evals", "AEV-", tx);
      const method = arr<string>(data.evalMethod)[0] ?? "Manager confirmation";
      for (const u of audience) {
        if (evals.some((e) => e.memberId === u.id)) continue;
        evals.push({
          id: `AEV-${pad(++seq)}`, memberId: u.id, memberName: u.name, topicId: topic0,
          method, result: "Not Evaluated", score: "", evaluator: "", evalDate: "",
          followupRequired: false, followupActionId: "", notes: "",
        });
      }
    }

    data.acks = acks;
    data.evals = evals;
    data.launchedAt = now;
    data.launchedBy = (await actorName(auth)) ?? "";
    r.status = deriveCampaignStatus("Active", data);
    r.data = data;
    await r.save({ transaction: tx });
    return { r, recipients: audience.length };
  });

  await writeAudit({
    actorUserId: auth.userId, organizationId: result.r.orgId,
    action: "ms.awareness-campaigns.launched", entityType: "ImplementationRecord", entityId: result.r.id,
    sourceIp: ip, result: "Success", metadata: { recipients: result.recipients },
  });
  await logActivity(auth, result.r.orgId, "awareness-campaigns", result.r.id,
    `Launched campaign — ${result.recipients} recipient${result.recipients === 1 ? "" : "s"}`);
  return decorateCampaignView(view(result.r));
}

// --- Atomic nested-ledger mutation plumbing -----------------------------------

interface MutationOutcome {
  activity: string;
  auditAction: string;
  metadata?: Record<string, unknown>;
  /** Runs inside the transaction, after the campaign row is saved. */
  after?: (tx: Transaction, r: ImplementationRecord) => Promise<void>;
}

async function mutateCampaign(
  auth: AuthContext, id: string, ip: string | null,
  mutator: (data: Record<string, unknown>, r: ImplementationRecord, tx: Transaction) => Promise<MutationOutcome> | MutationOutcome,
): Promise<{ r: ImplementationRecord; outcome: MutationOutcome }> {
  const result = await sequelize.transaction(async (tx) => {
    const r = await requireCampaign(auth, id, tx);
    const data = { ...(r.data ?? {}) } as Record<string, unknown>;
    const outcome = await mutator(data, r, tx);
    r.status = deriveCampaignStatus(r.status, data);
    r.data = data;
    await r.save({ transaction: tx });
    if (outcome.after) await outcome.after(tx, r);
    return { r, outcome };
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: result.r.orgId,
    action: result.outcome.auditAction, entityType: "ImplementationRecord", entityId: result.r.id,
    sourceIp: ip, result: "Success", metadata: result.outcome.metadata,
  });
  await logActivity(auth, result.r.orgId, "awareness-campaigns", result.r.id, result.outcome.activity);
  return result;
}

function requireAck(data: Record<string, unknown>, ackId: string): AwAck {
  const acks = arr<AwAck>(data.acks);
  const a = acks.find((x) => x.id === ackId);
  if (!a) throw new NotFoundError("Acknowledgment record does not exist", "ACK_NOT_FOUND");
  return a;
}

function requireEval(data: Record<string, unknown>, evalId: string): AwEval {
  const evals = arr<AwEval>(data.evals);
  const e = evals.find((x) => x.id === evalId);
  if (!e) throw new NotFoundError("Evaluation record does not exist", "EVAL_NOT_FOUND");
  return e;
}

function replaceRow<T extends { id: string }>(data: Record<string, unknown>, key: "acks" | "evals", row: T): void {
  data[key] = arr<T>(data[key]).map((x) => (x.id === row.id ? row : x));
}

// --- Acknowledgment mutations (OD `awAckDo`/`awAckRemind`/`awAckWaive`) -------

/** OD `awAckDo` (14580): Pending/Overdue → Acknowledged, stamped now. */
export async function acknowledgeAck(auth: AuthContext, campaignId: string, ackId: string, ip: string | null): Promise<CampaignRecordView> {
  const { r } = await mutateCampaign(auth, campaignId, ip, (data) => {
    const a = requireAck(data, ackId);
    if (a.status === "Acknowledged" || a.status === "Waived") {
      throw new BadRequestError("This acknowledgment is already final", "ACK_ALREADY_FINAL");
    }
    replaceRow(data, "acks", { ...a, status: "Acknowledged", ackDate: new Date().toISOString() });
    return {
      activity: `Acknowledgment completed — ${a.memberName}`,
      auditAction: "ms.awareness-campaigns.ackCompleted",
      metadata: { ackId },
    };
  });
  return decorateCampaignView(view(r));
}

/**
 * OD `awAckRemind` (14581): stamps `reminderDate` and raises a bell
 * notification for the recipient through the notifications module. Gated on
 * the org's `reminders` setting.
 */
export async function remindAck(auth: AuthContext, campaignId: string, ackId: string, ip: string | null): Promise<CampaignRecordView> {
  const settings = await getAwSettings((await requireCampaign(auth, campaignId)).orgId);
  if (!settings.reminders) throw new BadRequestError("Reminders are disabled in awareness settings", "REMINDERS_DISABLED");
  const { r } = await mutateCampaign(auth, campaignId, ip, (data, rec) => {
    const a = requireAck(data, ackId);
    if (a.status === "Acknowledged" || a.status === "Waived") {
      throw new BadRequestError("This acknowledgment is already final", "ACK_ALREADY_FINAL");
    }
    replaceRow(data, "acks", { ...a, reminderDate: new Date().toISOString() });
    return {
      activity: `Reminder sent — ${a.memberName}`,
      auditAction: "ms.awareness-campaigns.ackReminded",
      metadata: { ackId },
      after: async () => {
        await createNotification({
          orgId: rec.orgId, userId: a.memberId, type: "awareness",
          text: `Awareness reminder: please acknowledge "${rec.title}"${a.due ? ` by ${a.due.slice(0, 10)}` : ""}`,
          link: "/implementation/awareness?tab=acks",
        });
      },
    };
  });
  return decorateCampaignView(view(r));
}

/** OD `awAckWaive` (14582–14586): requires a typed reason, stamps who + when. */
export async function waiveAck(auth: AuthContext, campaignId: string, ackId: string, reason: string, ip: string | null): Promise<CampaignRecordView> {
  if (!reason || !reason.trim()) throw new BadRequestError("Waiver reason is required", "WAIVER_REASON_REQUIRED");
  const who = (await actorName(auth)) ?? "";
  const { r } = await mutateCampaign(auth, campaignId, ip, (data) => {
    const a = requireAck(data, ackId);
    if (a.status === "Acknowledged" || a.status === "Waived") {
      throw new BadRequestError("This acknowledgment is already final", "ACK_ALREADY_FINAL");
    }
    replaceRow(data, "acks", {
      ...a, status: "Waived", waiverReason: reason.trim(), waivedBy: who, waivedDate: new Date().toISOString(),
    });
    const trunc = reason.trim().length > 40 ? `${reason.trim().slice(0, 40)}…` : reason.trim();
    return {
      activity: `Acknowledgment waived — ${a.memberName} — ${trunc}`,
      auditAction: "ms.awareness-campaigns.ackWaived",
      metadata: { ackId },
    };
  });
  return decorateCampaignView(view(r));
}

// --- Evaluation mutations (OD `awEvalRecord`/`awEvalFollowup`/`awEvalToTP`) ---

export interface EvalResultInput {
  method?: string; result: string; score?: string; evaluator?: string; notes?: string;
}

/** OD `awEvalRecord` (14622): record the result; Failed arms the follow-up flag. */
export async function recordEvaluation(
  auth: AuthContext, campaignId: string, evalId: string, input: EvalResultInput, ip: string | null,
): Promise<CampaignRecordView> {
  if (!(AW_EVAL_RESULTS as readonly string[]).includes(input.result)) {
    throw new BadRequestError("Invalid evaluation result", "INVALID_EVAL_RESULT");
  }
  if (input.method !== undefined && !(AW_EVAL_METHODS as readonly string[]).includes(input.method)) {
    throw new BadRequestError("Invalid evaluation method", "INVALID_EVAL_METHOD");
  }
  const who = (await actorName(auth)) ?? "";
  const { r } = await mutateCampaign(auth, campaignId, ip, (data) => {
    const e = requireEval(data, evalId);
    replaceRow(data, "evals", {
      ...e,
      method: input.method ?? e.method ?? "Manager confirmation",
      result: input.result,
      score: input.score?.trim() ?? e.score ?? "",
      evaluator: input.evaluator?.trim() || who,
      evalDate: new Date().toISOString(),
      notes: input.notes?.trim() ?? e.notes ?? "",
      followupRequired: input.result === "Failed",
    });
    return {
      activity: `Evaluation completed — ${e.memberName} — ${input.result}`,
      auditAction: "ms.awareness-campaigns.evalRecorded",
      metadata: { evalId, result: input.result },
    };
  });
  return decorateCampaignView(view(r));
}

export interface FollowupInput {
  title: string; description?: string; owner?: string; due?: string; priority?: string;
}

/** OD `awEvalFollowup` (14629): a Failed evaluation raises `data.followups[]`. */
export async function createEvalFollowup(
  auth: AuthContext, campaignId: string, evalId: string, input: FollowupInput, ip: string | null,
): Promise<CampaignRecordView> {
  if (!input.title || !input.title.trim()) throw new BadRequestError("Action title is required", "TITLE_REQUIRED");
  const priority = input.priority ?? "Medium";
  if (!(AW_FOLLOWUP_PRIORITIES as readonly string[]).includes(priority)) {
    throw new BadRequestError("Invalid priority", "INVALID_PRIORITY");
  }
  const who = (await actorName(auth)) ?? "";
  const { r } = await mutateCampaign(auth, campaignId, ip, async (data, rec, tx) => {
    const e = requireEval(data, evalId);
    if (e.result !== "Failed") {
      throw new BadRequestError("Follow-up actions are raised from failed evaluations", "EVAL_NOT_FAILED");
    }
    const seq = await nextNestedId(rec.orgId, "followups", "AWF-", tx);
    const fid = `AWF-${pad(seq + 1)}`;
    const followup: AwFollowup = {
      id: fid, source: "Awareness", campaignId: rec.id, campaignCode: rec.code,
      topicId: e.topicId, memberId: e.memberId, memberName: e.memberName,
      title: input.title.trim(), description: input.description?.trim() ?? "",
      owner: input.owner?.trim() || who, due: input.due ?? "", priority,
      status: "Open", trainingPlanId: "", createdBy: who, createdDate: new Date().toISOString(),
    };
    data.followups = [...arr<AwFollowup>(data.followups), followup];
    replaceRow(data, "evals", { ...e, followupActionId: fid, followupRequired: true });
    return {
      activity: `Follow-up action created — ${followup.title}`,
      auditAction: "ms.awareness-campaigns.followupCreated",
      metadata: { evalId, followupId: fid },
    };
  });
  return decorateCampaignView(view(r));
}

/**
 * OD `awEvalToTP` (14639): a failed evaluation raises a Training Plan record
 * (`training` register) with `source: "Awareness Follow-up"`, cross-linked both
 * ways — the eval stores the training code/id, the training record stores the
 * campaign/topic/eval ids.
 */
export async function evalToTrainingPlan(
  auth: AuthContext, campaignId: string, evalId: string, ip: string | null,
): Promise<{ campaign: CampaignRecordView; training: CampaignRecordView }> {
  const who = (await actorName(auth)) ?? "";
  let training!: ImplementationRecord;
  const { r } = await mutateCampaign(auth, campaignId, ip, async (data, rec, tx) => {
    const e = requireEval(data, evalId);
    if (e.result !== "Failed") {
      throw new BadRequestError("Training plan items are raised from failed evaluations", "EVAL_NOT_FAILED");
    }
    const topic = e.topicId
      ? await ImplementationRecord.findOne({ where: { id: e.topicId, module: "awareness-topics", orgId: rec.orgId }, transaction: tx })
      : null;
    // Training code sequence — same per-org, prefix-driven scheme as the
    // register's own `nextCode` (registry.ts `training.prefix`, "TP").
    const trainingPrefix = MS_MODULES.training.prefix;
    const rows = await ImplementationRecord.findAll({ where: { module: "training", orgId: rec.orgId }, attributes: ["code"], transaction: tx });
    let max = 0;
    for (const row of rows) {
      const n = Number.parseInt(row.code.replace(new RegExp(`^${trainingPrefix}-`), ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    const title = `Awareness re-training: ${topic?.title ?? rec.title}`;
    training = await ImplementationRecord.create({
      orgId: rec.orgId, module: "training", code: `${trainingPrefix}-${pad(max + 1)}`,
      title, status: "Planned", owner: null, elementId: null, frameworks: rec.frameworks ?? [],
      data: {
        source: "Awareness Follow-up", sourceRecordId: evalId,
        person: e.memberName, course: title,
        dueDate: (str(data.dueDate) || str(data.due)).slice(0, 10), priority: "Medium",
        description: `Follow-up training created from a failed awareness evaluation (${evalId}).`,
        awCampaignId: rec.id, awCampaignCode: rec.code, awTopicId: e.topicId ?? "", awEvalId: evalId,
      },
    }, { transaction: tx });
    replaceRow(data, "evals", { ...e, followupActionId: training.code, trainingPlanId: training.id, followupRequired: true });
    return {
      activity: `Training plan item created — ${training.code}`,
      auditAction: "ms.awareness-campaigns.trainingRaised",
      metadata: { evalId, trainingId: training.id },
      after: async (tx2) => {
        void tx2;
        await writeAudit({
          actorUserId: auth.userId, organizationId: rec.orgId,
          action: "ms.training.created", entityType: "ImplementationRecord", entityId: training.id,
          sourceIp: ip, result: "Success", metadata: { source: "Awareness Follow-up", awEvalId: evalId },
        });
      },
    };
  });
  await logActivity(auth, r.orgId, "training", training.id, `Created from awareness evaluation ${evalId} (${r.code}) by ${who || "system"}`);
  return { campaign: decorateCampaignView(view(r)), training: view(training) };
}
