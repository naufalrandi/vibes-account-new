import { randomUUID } from "node:crypto";
import { Op, Model, type ModelStatic } from "sequelize";
import { MReview } from "../../db/models";
import {
  MR_FORMATS, MR_STATUS, MR_OUTPUT_CATEGORY, MR_DECISION_STATUS, MR_ITEM_STATUS, MR_TOPIC_CATALOG,
  type MrTopic, type MrInvitee, type MrExternal, type MrAction,
} from "../../db/models/evaluation.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * Management Review (ISO 9.3). One entity: a scheduled review meeting whose
 * `topics` array is seeded from a fixed catalog of standard input topics
 * (`MR_TOPIC_CATALOG`) the org selects a subset of. `update` mirrors the
 * mockup's `mrSave` merge (OD): keep recorded entries for titles still
 * selected, append blanks for newly-selected titles, drop deselected ones.
 * `record` is a dedicated bulk-update of topic outputs (OD `mrRecord`).
 */

async function targetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}

async function orgWhere(auth: AuthContext, orgId?: string): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  if (orgId) return { orgId: await targetOrg(auth, orgId) };
  if (ids !== null) return { orgId: { [Op.in]: ids } };
  return {};
}

async function nextCode(model: ModelStatic<Model>, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } } });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(String(r.get("code")).slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

async function logAudit(auth: AuthContext, orgId: string, action: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, action, entityType: "MReview", entityId, sourceIp: ip, result: "Success" });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function parseInvited(input: unknown): MrInvitee[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestError("invited must be an array", "INVALID_INVITED");
  return input.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new BadRequestError(`invited[${i}] must be an object`, "INVALID_INVITED");
    const rec = raw as Record<string, unknown>;
    return { name: str(rec.name) ?? "", req: str(rec.req) ?? "Required", att: str(rec.att) ?? "Pending" };
  });
}

function parseExternal(input: unknown): MrExternal[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestError("external must be an array", "INVALID_EXTERNAL");
  return input.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new BadRequestError(`external[${i}] must be an object`, "INVALID_EXTERNAL");
    return { name: str((raw as Record<string, unknown>).name) ?? "" };
  });
}

function blankTopic(title: string): MrTopic {
  return {
    id: randomUUID(), title, desc: "", frameworks: [], inputSummary: "", output: "",
    outputCategory: "No Action Required", decisionStatus: "No Action Required", itemStatus: "Not Started",
    action: null, responsible: "", due: null,
  };
}

/** OD `mrSave` merge: keep recorded entries whose title is still selected, add blanks for new titles, drop deselected. */
function mergeTopics(existing: MrTopic[], selectedTitles: string[]): MrTopic[] {
  const kept = existing.filter((t) => selectedTitles.includes(t.title));
  const keptTitles = new Set(kept.map((t) => t.title));
  const added = selectedTitles.filter((title) => !keptTitles.has(title)).map(blankTopic);
  return [...kept, ...added];
}

function parseTopicTitles(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new BadRequestError("topics must be an array of topic titles", "INVALID_TOPICS");
  const titles = input.map(String);
  const invalid = titles.filter((t) => !(MR_TOPIC_CATALOG as readonly string[]).includes(t));
  if (invalid.length > 0) throw new BadRequestError(`Unknown topic title(s): ${invalid.join(", ")}`, "INVALID_TOPIC_TITLE");
  return titles;
}

export async function listMReviews(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await MReview.findAll({ where, order: [["date", "DESC"]] })).map((r) => r.get({ plain: true }));
}

export async function getMReview(auth: AuthContext, id: string) {
  const row = await MReview.findByPk(id);
  if (!row) throw new NotFoundError("Management review not found", "MREVIEW_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row.get({ plain: true });
}

export async function createMReview(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const date = str(input.date);
  const time = str(input.time);
  if (!date) throw new BadRequestError("Review date is required", "DATE_REQUIRED");
  if (!time) throw new BadRequestError("Review time is required", "TIME_REQUIRED");
  const format = str(input.format) ?? "Virtual";
  if (!(MR_FORMATS as readonly string[]).includes(format)) throw new BadRequestError(`Invalid format "${format}"`, "INVALID_FORMAT");
  const topicTitles = parseTopicTitles(input.topics);
  const who = await actorName(auth);
  const row = await MReview.create({
    orgId: org, code: await nextCode(MReview, "MR"), title: str(input.title),
    frameworks: arr(input.frameworks), date, time, tz: str(input.tz) || "Asia/Jakarta", format,
    link: str(input.link), location: str(input.location), chairperson: str(input.chairperson), recorder: str(input.recorder),
    status: "Draft", invited: parseInvited(input.invited), external: parseExternal(input.external),
    agenda: str(input.agenda), prep: str(input.prep), materials: str(input.materials),
    topics: topicTitles.map(blankTopic), version: 1, createdBy: who, lastUpdatedBy: who,
  });
  await logAudit(auth, org, "mreview.created", row.id, ip);
  return row.get({ plain: true });
}

const MR_STR_FIELDS = ["title", "date", "time", "tz", "link", "location", "chairperson", "recorder", "agenda", "prep", "materials"] as const;

export async function updateMReview(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await MReview.findByPk(id);
  if (!row) throw new NotFoundError("Management review not found", "MREVIEW_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of MR_STR_FIELDS) if (input[k] !== undefined) rec[k] = str(input[k]);
  if (input.format !== undefined) {
    const format = str(input.format) ?? "Virtual";
    if (!(MR_FORMATS as readonly string[]).includes(format)) throw new BadRequestError(`Invalid format "${format}"`, "INVALID_FORMAT");
    row.format = format;
  }
  if (input.frameworks !== undefined) row.frameworks = arr(input.frameworks);
  if (input.invited !== undefined) row.invited = parseInvited(input.invited);
  if (input.external !== undefined) row.external = parseExternal(input.external);
  if (input.topics !== undefined) row.topics = mergeTopics(row.topics, parseTopicTitles(input.topics));
  row.version = (row.version ?? 1) + 1;
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  await row.save();
  await logAudit(auth, row.orgId, "mreview.updated", row.id, ip);
  return row.get({ plain: true });
}

export async function setMReviewStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!(MR_STATUS as readonly string[]).includes(status)) throw new BadRequestError(`Invalid status "${status}"`, "INVALID_STATUS");
  const row = await MReview.findByPk(id);
  if (!row) throw new NotFoundError("Management review not found", "MREVIEW_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const who = await actorName(auth);
  row.status = status;
  row.lastUpdatedBy = who;
  if (status === "Finalized") { row.finalizedBy = who; row.finalizedDate = new Date().toISOString(); }
  await row.save();
  await logAudit(auth, row.orgId, "mreview.status", row.id, ip);
  return row.get({ plain: true });
}

export interface RecordTopicInput {
  id: string;
  inputSummary?: string;
  output?: string;
  outputCategory?: string;
  decisionStatus?: string;
  itemStatus?: string;
  action?: Partial<MrAction> | null;
}

/** OD `mrRecord`: bulk-record the outputs of one or more topics by id. */
export async function recordMReviewOutputs(auth: AuthContext, id: string, topicInputs: RecordTopicInput[], ip: string | null) {
  const row = await MReview.findByPk(id);
  if (!row) throw new NotFoundError("Management review not found", "MREVIEW_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  if (!Array.isArray(topicInputs) || topicInputs.length === 0) throw new BadRequestError("At least one topic entry is required", "TOPICS_REQUIRED");
  const byId = new Map(topicInputs.map((t) => [t.id, t]));
  row.topics = row.topics.map((t) => {
    const patch = byId.get(t.id);
    if (!patch) return t;
    if (patch.outputCategory !== undefined && !(MR_OUTPUT_CATEGORY as readonly string[]).includes(patch.outputCategory)) {
      throw new BadRequestError(`Invalid output category "${patch.outputCategory}"`, "INVALID_OUTPUT_CATEGORY");
    }
    if (patch.decisionStatus !== undefined && !(MR_DECISION_STATUS as readonly string[]).includes(patch.decisionStatus)) {
      throw new BadRequestError(`Invalid decision status "${patch.decisionStatus}"`, "INVALID_DECISION_STATUS");
    }
    if (patch.itemStatus !== undefined && !(MR_ITEM_STATUS as readonly string[]).includes(patch.itemStatus)) {
      throw new BadRequestError(`Invalid item status "${patch.itemStatus}"`, "INVALID_ITEM_STATUS");
    }
    const action: MrAction | null = patch.action === undefined ? t.action
      : patch.action === null ? null
      : { title: str(patch.action.title) ?? "", desc: str(patch.action.desc) ?? "", owner: str(patch.action.owner) ?? "", due: str(patch.action.due), priority: str(patch.action.priority) ?? "Medium", status: str(patch.action.status) ?? "Not Started" };
    return {
      ...t,
      inputSummary: patch.inputSummary !== undefined ? (str(patch.inputSummary) ?? "") : t.inputSummary,
      output: patch.output !== undefined ? (str(patch.output) ?? "") : t.output,
      outputCategory: patch.outputCategory ?? t.outputCategory,
      decisionStatus: patch.decisionStatus ?? t.decisionStatus,
      itemStatus: patch.itemStatus ?? t.itemStatus,
      action,
    };
  });
  const missing = topicInputs.filter((t) => !row.topics.some((rt) => rt.id === t.id));
  if (missing.length > 0) throw new NotFoundError(`Unknown topic id(s): ${missing.map((m) => m.id).join(", ")}`, "TOPIC_NOT_FOUND");
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  if (row.status === "Draft" || row.status === "Scheduled" || row.status === "In Progress") row.status = "Pending Outputs";
  await row.save();
  await logAudit(auth, row.orgId, "mreview.recorded", row.id, ip);
  return row.get({ plain: true });
}

export const CATALOG = { MR_FORMATS, MR_STATUS, MR_OUTPUT_CATEGORY, MR_DECISION_STATUS, MR_ITEM_STATUS, MR_TOPIC_CATALOG };
