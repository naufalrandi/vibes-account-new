import { Op, type WhereOptions } from "sequelize";
import { ImplementationRecord, Organization, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";

export interface RiskActivityEntry {
  ts: string;
  user: string;
  action: string;
  summary: string;
}

export interface ActionPlanResource {
  id: string;
  title: string;
  desc?: string;
  budget: number;
  currency: string;
}

export interface RiskActionPlan {
  id: string;
  title: string;
  deadline?: string;
  resources: ActionPlanResource[];
  pics: string[];
  status: "Draft" | "Planned" | "In Progress" | "Completed" | "Verified";
  createdAt: string;
  doneBy?: string;
  doneAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface RiskRtp {
  actionPlans: RiskActionPlan[];
  createdAt: string;
  createdBy: string;
  msApprovedBy?: string;
  msApprovedAt?: string;
  tmApprovedBy?: string;
  tmApprovedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface RiskRecordView {
  id: string;
  orgId: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  category: string;
  description: string;
  domains: string[];
  frameworks: string[];
  source: string;
  sourceIssueId?: string | null;
  sourceReqId?: string | null;
  processId?: string | null;
  stepId?: string | null;
  issueCategory?: string | null;
  raisedBy: string;
  raisedDate: string;
  methodology: "basic" | "quant";
  likelihood: number | null;
  impact: number | null;
  level: number | null;
  band: string;
  priority: "High" | "Medium" | "Low" | null;
  rtp: RiskRtp | null;
  activity: RiskActivityEntry[];
  createdAt: string;
  updatedAt: string;
}

export const RISK_CURRENCIES = ["IDR", "USD", "EUR", "SGD", "AUD", "GBP", "JPY", "MYR", "INR", "CNY", "THB"] as const;

// "Archived" is appended last (terminal) so RISK_STATUSES[0] ("Unassigned",
// the silent create default in createRisk()) is unchanged. archiveRisk()
// (below) writes "Archived" and updateRisk()'s status guard used to
// special-case it with a `next !== "Archived"` bypass + `as any` — proof the
// type could not express a value the service demonstrably writes. The
// Monitored-only/terminal transition rule for reaching "Archived" is
// enforced by archiveRisk()'s own precondition, not by this list.
export const RISK_STATUSES = [
  "Unassigned",
  "Assigned",
  "RTP Draft",
  "Pending Approval",
  "Pending TM Approval",
  "In Treatment",
  "Assessed",
  "Treated",
  "Monitored",
  "Archived",
] as const;

export type RiskStatus = (typeof RISK_STATUSES)[number];

function rUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function deriveTitle(description: string, providedTitle?: string): string {
  if (providedTitle && providedTitle.trim()) return providedTitle.trim();
  const words = (description || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 9).join(" ") || "Untitled Risk";
}

function computeRiskBand(
  level: number | null | undefined,
  levelsConfig?: { names: string[]; bounds: number[] }
): string {
  if (level == null || level <= 0) return "";
  const names = levelsConfig?.names || ["Low", "Medium", "High", "Critical"];
  const bounds = levelsConfig?.bounds || [4, 9, 15];

  if (level <= bounds[0]) return names[0] || "Low";
  if (level <= bounds[1]) return names[1] || "Medium";
  if (level <= bounds[2]) return names[2] || "High";
  return names[3] || "Critical";
}

async function getOrgRiskConfig(orgId: string): Promise<{
  riskMethod: string;
  riskLevels: { names: string[]; bounds: number[] };
  riskAppetite: number;
  riskAppetiteVer: number;
}> {
  const org = await Organization.findByPk(orgId);
  return {
    riskMethod: org?.riskMethod || "basic",
    riskLevels: org?.riskLevels || { names: ["Low", "Medium", "High", "Critical"], bounds: [4, 9, 15] },
    riskAppetite: org?.riskAppetite ?? 9,
    riskAppetiteVer: org?.riskAppetiteVer ?? 1,
  };
}

async function hasTopManagement(orgId: string): Promise<boolean> {
  const tmUser = await User.findOne({
    where: {
      orgId,
      status: "Active",
      personnelType: "Top Management",
    },
  });
  return !!tmUser;
}

function toRiskView(
  rec: ImplementationRecord,
  levelsConfig?: { names: string[]; bounds: number[] }
): RiskRecordView {
  const d = (rec.data || {}) as Record<string, unknown>;
  const rawLevel = typeof d.level === "number" ? d.level : (typeof d.likelihood === "number" && typeof d.impact === "number") ? d.likelihood * d.impact : null;
  const band = computeRiskBand(rawLevel, levelsConfig);

  return {
    id: rec.id,
    orgId: rec.orgId,
    code: rec.code,
    title: rec.title,
    status: rec.status,
    owner: rec.owner,
    category: String(d.category || "Quality Risks"),
    description: String(d.description || rec.title),
    domains: Array.isArray(d.domains) ? (d.domains as string[]) : [],
    frameworks: Array.isArray(rec.frameworks) ? rec.frameworks : Array.isArray(d.frameworks) ? (d.frameworks as string[]) : [],
    source: String(d.source || "Organizational Context"),
    sourceIssueId: d.sourceIssueId ? String(d.sourceIssueId) : null,
    sourceReqId: d.sourceReqId ? String(d.sourceReqId) : null,
    processId: d.processId ? String(d.processId) : null,
    stepId: d.stepId ? String(d.stepId) : null,
    issueCategory: d.issueCategory ? String(d.issueCategory) : null,
    raisedBy: String(d.raisedBy || "System"),
    raisedDate: String(d.raisedDate || (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : "")),
    methodology: d.methodology === "quant" ? "quant" : "basic",
    likelihood: typeof d.likelihood === "number" ? d.likelihood : null,
    impact: typeof d.impact === "number" ? d.impact : null,
    level: rawLevel,
    band,
    priority: d.priority === "High" || d.priority === "Medium" || d.priority === "Low" ? d.priority : null,
    rtp: (d.rtp as RiskRtp) || null,
    activity: Array.isArray(d.activity) ? (d.activity as RiskActivityEntry[]) : [],
    createdAt: rec.createdAt ? new Date(rec.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : new Date().toISOString(),
  };
}

async function nextRiskCode(orgId: string): Promise<string> {
  const rows = await ImplementationRecord.findAll({
    where: { module: "risks", orgId },
    attributes: ["code"],
  });
  let max = 0;
  for (const r of rows) {
    const m = /^RISK-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RISK-${String(max + 1).padStart(4, "0")}`;
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName || u?.username || "System User";
}

// ================================ CRUD ====================================

export async function listRisks(
  auth: AuthContext,
  filters: { status?: string; category?: string; search?: string; orgId?: string } = {}
): Promise<RiskRecordView[]> {
  const targetOrg = filters.orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);

  const where: WhereOptions = { module: "risks", orgId: targetOrg };
  if (filters.status) {
    where.status = filters.status;
  }

  const rows = await ImplementationRecord.findAll({ where, order: [["createdAt", "DESC"]] });
  const cfg = await getOrgRiskConfig(targetOrg);
  let views = rows.map((r) => toRiskView(r, cfg.riskLevels));

  if (filters.category) {
    views = views.filter((v) => v.category.toLowerCase() === filters.category!.toLowerCase());
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    views = views.filter(
      (v) =>
        v.code.toLowerCase().includes(q) ||
        v.title.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        (v.owner && v.owner.toLowerCase().includes(q))
    );
  }

  return views;
}

export async function getRiskById(auth: AuthContext, id: string): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function createRisk(
  auth: AuthContext,
  input: Record<string, unknown>,
  ip: string | null
): Promise<RiskRecordView> {
  const targetOrg = (input.orgId as string) || auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);

  const description = String(input.description || input.title || "").trim();
  if (!description) throw new BadRequestError("Description or Title is required", "DESCRIPTION_REQUIRED");

  const title = deriveTitle(description, input.title as string | undefined);
  const code = await nextRiskCode(targetOrg);
  const who = await actorName(auth);
  const today = new Date().toISOString().slice(0, 10);

  const methodology = input.methodology === "quant" ? "quant" : "basic";
  const likelihood = typeof input.likelihood === "number" ? input.likelihood : null;
  const impact = typeof input.impact === "number" ? input.impact : null;
  const rawLevel = likelihood && impact ? likelihood * impact : null;
  const priority = input.priority === "High" || input.priority === "Medium" || input.priority === "Low" ? input.priority : null;

  const initialStatus = input.owner ? "Assigned" : "Unassigned";
  const activity: RiskActivityEntry[] = [
    {
      ts: new Date().toISOString(),
      user: who,
      action: "Created",
      summary: `Risk created with status ${initialStatus}`,
    },
  ];

  const data: Record<string, unknown> = {
    category: input.category || "Quality Risks",
    description,
    domains: Array.isArray(input.domains) ? input.domains : [],
    frameworks: Array.isArray(input.frameworks) ? input.frameworks : [],
    source: input.source || "Organizational Context",
    sourceIssueId: input.sourceIssueId || null,
    sourceReqId: input.sourceReqId || null,
    processId: input.processId || null,
    stepId: input.stepId || null,
    issueCategory: input.issueCategory || null,
    raisedBy: who,
    raisedDate: today,
    methodology,
    likelihood,
    impact,
    level: rawLevel,
    priority,
    rtp: null,
    activity,
  };

  const rec = await ImplementationRecord.create({
    orgId: targetOrg,
    module: "risks",
    code,
    title,
    status: initialStatus,
    owner: (input.owner as string) || null,
    frameworks: Array.isArray(input.frameworks) ? (input.frameworks as string[]) : [],
    data,
  });

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: targetOrg,
    action: "risk.created",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(targetOrg);
  return toRiskView(rec, cfg.riskLevels);
}

export async function updateRisk(
  auth: AuthContext,
  id: string,
  input: Record<string, unknown>,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const who = await actorName(auth);

  if (input.title !== undefined) rec.title = String(input.title);
  if (input.owner !== undefined) {
    const prevOwner = rec.owner;
    rec.owner = (input.owner as string) || null;
    if (rec.owner && !prevOwner && rec.status === "Unassigned") {
      rec.status = "Assigned";
    }
  }
  if (input.status !== undefined) {
    const next = String(input.status);
    if (!(RISK_STATUSES as readonly string[]).includes(next)) {
      throw new BadRequestError(`Invalid risk status: ${next}`, "INVALID_STATUS");
    }
    rec.status = next;
  }

  if (input.category !== undefined) d.category = input.category;
  if (input.description !== undefined) d.description = input.description;
  if (input.domains !== undefined) d.domains = input.domains;
  if (input.frameworks !== undefined) {
    d.frameworks = input.frameworks;
    rec.frameworks = Array.isArray(input.frameworks) ? (input.frameworks as string[]) : rec.frameworks;
  }
  if (input.source !== undefined) d.source = input.source;
  if (input.methodology !== undefined) d.methodology = input.methodology === "quant" ? "quant" : "basic";
  if (input.likelihood !== undefined) d.likelihood = typeof input.likelihood === "number" ? input.likelihood : null;
  if (input.impact !== undefined) d.impact = typeof input.impact === "number" ? input.impact : null;

  if (d.likelihood && d.impact) {
    d.level = (d.likelihood as number) * (d.impact as number);
  }
  if (input.priority !== undefined) d.priority = input.priority;

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Updated",
    summary: "Risk attributes updated",
  });
  d.activity = activity;
  rec.data = d;

  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.updated",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function deleteRisk(auth: AuthContext, id: string, ip: string | null): Promise<{ id: string }> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  await rec.destroy();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.deleted",
    entityType: "Risk",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });

  return { id };
}

// ========================== WORKFLOW & RTP ================================

export async function assignOwner(
  auth: AuthContext,
  id: string,
  owner: string,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const who = await actorName(auth);
  const d = (rec.data || {}) as Record<string, unknown>;

  rec.owner = owner;
  if (rec.status === "Unassigned") {
    rec.status = "Assigned";
  }

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Owner Assigned",
    summary: `Risk assigned to ${owner}`,
  });
  d.activity = activity;
  rec.data = d;
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.owner_assigned",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function archiveRisk(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  if (rec.status === "Archived") {
    throw new BadRequestError("Risk already archived", "RISK_ALREADY_ARCHIVED");
  }
  if (rec.status !== "Monitored") {
    throw new BadRequestError('Risk must reach "Monitored" before it can be archived.', "RISK_NOT_MONITORED");
  }

  const who = await actorName(auth);
  const d = (rec.data || {}) as Record<string, unknown>;

  rec.status = "Archived";
  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Archived",
    summary: "Risk archived from Monitored status",
  });
  d.activity = activity;
  rec.data = d;
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.archived",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function generateRtp(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  if (!rec.owner) {
    throw new BadRequestError("Assign a risk owner first", "OWNER_REQUIRED");
  }
  const d = (rec.data || {}) as Record<string, unknown>;
  if (d.rtp) {
    throw new BadRequestError("A treatment plan already exists for this risk", "RTP_EXISTS");
  }

  const who = await actorName(auth);
  const rtp: RiskRtp = {
    actionPlans: [],
    createdAt: new Date().toISOString(),
    createdBy: who,
  };

  d.rtp = rtp;
  rec.status = "RTP Draft";

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "RTP Initialized",
    summary: "Risk Treatment Plan created (RTP Draft)",
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_generated",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function addActionPlan(
  auth: AuthContext,
  id: string,
  input: { title: string; deadline?: string; resources?: ActionPlanResource[]; pics?: string[] },
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  if (!input.title || !input.title.trim()) {
    throw new BadRequestError("Action plan title is required", "TITLE_REQUIRED");
  }

  const who = await actorName(auth);
  const d = (rec.data || {}) as Record<string, unknown>;
  let rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) {
    rtp = {
      actionPlans: [],
      createdAt: new Date().toISOString(),
      createdBy: who,
    };
  }

  const ap: RiskActionPlan = {
    id: rUid("ap"),
    title: input.title.trim(),
    deadline: input.deadline || "",
    resources: Array.isArray(input.resources) ? input.resources : [],
    pics: Array.isArray(input.pics) ? input.pics : [],
    status: "Draft",
    createdAt: new Date().toISOString(),
  };

  rtp.actionPlans.push(ap);
  d.rtp = rtp;
  if (rec.status === "Unassigned" || rec.status === "Assigned") {
    rec.status = "RTP Draft";
  }

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Action Plan Added",
    summary: `Action plan "${ap.title}" added to RTP`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.action_plan_added",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function updateActionPlan(
  auth: AuthContext,
  id: string,
  apId: string,
  input: Partial<RiskActionPlan>,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new NotFoundError("RTP not found", "RTP_NOT_FOUND");

  const ap = rtp.actionPlans.find((a) => a.id === apId);
  if (!ap) throw new NotFoundError("Action plan not found", "ACTION_PLAN_NOT_FOUND");

  const who = await actorName(auth);
  if (input.title !== undefined) ap.title = input.title.trim();
  if (input.deadline !== undefined) ap.deadline = input.deadline;
  if (input.resources !== undefined) ap.resources = input.resources;
  if (input.pics !== undefined) ap.pics = input.pics;
  if (input.status !== undefined) {
    ap.status = input.status;
    if (ap.status === "Completed" && !ap.doneAt) {
      ap.doneAt = new Date().toISOString();
      ap.doneBy = who;
    }
  }

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Action Plan Updated",
    summary: `Action plan "${ap.title}" updated`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.action_plan_updated",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function deleteActionPlan(
  auth: AuthContext,
  id: string,
  apId: string,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new NotFoundError("RTP not found", "RTP_NOT_FOUND");

  const idx = rtp.actionPlans.findIndex((a) => a.id === apId);
  if (idx === -1) throw new NotFoundError("Action plan not found", "ACTION_PLAN_NOT_FOUND");

  const deletedTitle = rtp.actionPlans[idx].title;
  rtp.actionPlans.splice(idx, 1);
  d.rtp = rtp;

  const who = await actorName(auth);
  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Action Plan Deleted",
    summary: `Action plan "${deletedTitle}" removed from RTP`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.action_plan_deleted",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function proposeRtp(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp || !(rtp.actionPlans || []).length) {
    throw new BadRequestError("Add at least one action plan first", "ACTION_PLANS_REQUIRED");
  }

  const who = await actorName(auth);
  rec.status = "Pending Approval";

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "RTP Proposed",
    summary: `RTP submitted for approval with ${rtp.actionPlans.length} action plans`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_proposed",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function approveRtp(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new BadRequestError("No RTP to approve", "NO_RTP");

  const cfg = await getOrgRiskConfig(rec.orgId);
  const view = toRiskView(rec, cfg.riskLevels);
  if (view.methodology === "quant" && (view.band === "High" || view.band === "Critical")) {
    throw new BadRequestError("High and Critical quantitative risks must be escalated to Top Management", "ESCALATION_REQUIRED");
  }

  const who = await actorName(auth);
  const now = new Date().toISOString();
  rtp.approvedBy = who;
  rtp.approvedAt = now;

  rec.status = "In Treatment";
  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: now,
    user: who,
    action: "RTP Approved",
    summary: "RTP approved; treatment in progress",
  });
  d.activity = activity;
  d.rtp = rtp;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_approved",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  return toRiskView(rec, cfg.riskLevels);
}

export async function approveRtpMS(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new BadRequestError("No RTP to approve", "NO_RTP");

  const who = await actorName(auth);
  const now = new Date().toISOString();
  rtp.msApprovedBy = who;
  rtp.msApprovedAt = now;

  const hasTM = await hasTopManagement(rec.orgId);
  const activity = (d.activity as RiskActivityEntry[]) || [];

  if (hasTM) {
    rec.status = "Pending TM Approval";
    activity.unshift({
      ts: now,
      user: who,
      action: "MS Approval Granted",
      summary: "MS approved RTP; routed to Top Management for final sign-off",
    });
  } else {
    rtp.approvedBy = who;
    rtp.approvedAt = now;
    rec.status = "In Treatment";
    activity.unshift({
      ts: now,
      user: who,
      action: "RTP Approved (MS)",
      summary: "No separate Top Management detected; approved directly into treatment",
    });
  }

  d.activity = activity;
  d.rtp = rtp;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_approved_ms",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function approveRtpTM(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new BadRequestError("No RTP to approve", "NO_RTP");

  const who = await actorName(auth);
  const now = new Date().toISOString();
  rtp.tmApprovedBy = who;
  rtp.tmApprovedAt = now;
  rtp.approvedBy = who;
  rtp.approvedAt = now;

  rec.status = "In Treatment";
  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: now,
    user: who,
    action: "Top Management Approval Granted",
    summary: "Top Management approved RTP; risk entered In Treatment",
  });
  d.activity = activity;
  d.rtp = rtp;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_approved_tm",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function rejectRtp(
  auth: AuthContext,
  id: string,
  reason: string,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  if (!reason || !reason.trim()) {
    throw new BadRequestError("Rejection reason is required", "REASON_REQUIRED");
  }

  const who = await actorName(auth);
  const d = (rec.data || {}) as Record<string, unknown>;
  rec.status = "RTP Draft";

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "RTP Rejected",
    summary: `RTP returned to draft: ${reason.trim()}`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_rejected",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function escalateRtp(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const who = await actorName(auth);
  const d = (rec.data || {}) as Record<string, unknown>;
  rec.status = "Pending TM Approval";

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Escalated",
    summary: "RTP escalated directly to Top Management for governance review",
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.rtp_escalated",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function verifyActionPlan(
  auth: AuthContext,
  id: string,
  apId: string,
  ip: string | null
): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  if (!rtp) throw new NotFoundError("RTP not found", "RTP_NOT_FOUND");

  const ap = rtp.actionPlans.find((a) => a.id === apId);
  if (!ap) throw new NotFoundError("Action plan not found", "ACTION_PLAN_NOT_FOUND");

  const who = await actorName(auth);
  ap.status = "Verified";
  ap.verifiedBy = who;
  ap.verifiedAt = new Date().toISOString();

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Action Plan Verified",
    summary: `Effectiveness check verified for "${ap.title}"`,
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.action_plan_verified",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

export async function completeTreatment(auth: AuthContext, id: string, ip: string | null): Promise<RiskRecordView> {
  const rec = await ImplementationRecord.findOne({ where: { id, module: "risks" } });
  if (!rec) throw new NotFoundError("Risk not found", "RISK_NOT_FOUND");
  await assertCanSeeOrg(auth, rec.orgId);

  const d = (rec.data || {}) as Record<string, unknown>;
  const rtp = (d.rtp as RiskRtp) || null;
  const aps = rtp?.actionPlans || [];

  if (!aps.length || !aps.every((a) => a.status === "Verified")) {
    throw new BadRequestError("All action plans must be verified first", "ACTION_PLANS_NOT_VERIFIED");
  }

  const who = await actorName(auth);
  rec.status = "Monitored";

  const activity = (d.activity as RiskActivityEntry[]) || [];
  activity.unshift({
    ts: new Date().toISOString(),
    user: who,
    action: "Treatment Completed",
    summary: "All action plans verified; risk transitioned to Monitored",
  });
  d.activity = activity;
  rec.set("data", { ...d });
  rec.changed("data", true);
  await rec.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: rec.orgId,
    action: "risk.treatment_completed",
    entityType: "Risk",
    entityId: rec.id,
    sourceIp: ip,
    result: "Success",
  });

  const cfg = await getOrgRiskConfig(rec.orgId);
  return toRiskView(rec, cfg.riskLevels);
}

// ======================= TENANT CONFIG ====================================

export async function getTenantRiskConfig(auth: AuthContext, orgId?: string) {
  const targetOrg = orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);
  return getOrgRiskConfig(targetOrg);
}

export async function updateTenantRiskConfig(
  auth: AuthContext,
  input: { riskMethod?: string; riskLevels?: { names: string[]; bounds: number[] }; riskAppetite?: number },
  ip: string | null
) {
  const targetOrg = auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);

  const org = await Organization.findByPk(targetOrg);
  if (!org) throw new NotFoundError("Organization not found", "ORG_NOT_FOUND");

  if (input.riskMethod !== undefined) {
    if (!["basic", "quant"].includes(input.riskMethod)) {
      throw new BadRequestError("Invalid methodology; must be 'basic' or 'quant'", "INVALID_METHOD");
    }
    org.riskMethod = input.riskMethod;
  }

  if (input.riskLevels !== undefined) {
    const { names, bounds } = input.riskLevels;
    if (!Array.isArray(names) || names.length !== 4 || !Array.isArray(bounds) || bounds.length !== 3) {
      throw new BadRequestError("Risk levels require 4 band names and 3 threshold bounds", "INVALID_LEVELS");
    }
    org.riskLevels = input.riskLevels;
  }

  if (input.riskAppetite !== undefined) {
    if (typeof input.riskAppetite !== "number" || input.riskAppetite < 1 || input.riskAppetite > 25) {
      throw new BadRequestError("Risk appetite must be between 1 and 25", "INVALID_APPETITE");
    }
    org.riskAppetite = input.riskAppetite;
    org.riskAppetiteVer = (org.riskAppetiteVer || 1) + 1;
  }

  await org.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: targetOrg,
    action: "risk.config_updated",
    entityType: "Organization",
    entityId: targetOrg,
    sourceIp: ip,
    result: "Success",
  });

  return getOrgRiskConfig(targetOrg);
}
