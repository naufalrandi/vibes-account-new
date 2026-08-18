import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { MsScope, Organization } from "../../db/models";
import {
  SCOPE_DIMS, MS_SCOPESTAT, SCOPE_DSTAT,
  type ScopeDimRow, type ScopeCounts, type ScopeBaseline, type ScopeDiffEntry,
} from "../../db/models/scope.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const inScope = (r: ScopeDimRow) => r.status === "Included" || r.status === "Partially Included";

async function actorName(auth: AuthContext): Promise<string> {
  const { User } = await import("../../db/models");
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}
async function targetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}
async function nextCode(): Promise<string> {
  const rows = await MsScope.findAll({ attributes: ["code"], where: { code: { [Op.like]: "SCOPE-%" } } });
  let max = 0;
  for (const r of rows) { const n = Number.parseInt(r.code.slice(6), 10); if (Number.isFinite(n) && n > max) max = n; }
  return `SCOPE-${String(max + 1).padStart(4, "0")}`;
}
async function audit(auth: AuthContext, orgId: string, action: string, id: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, action, entityType: "MsScope", entityId: id, sourceIp: ip, result: "Success" });
}
function pushActivity(list: MsScope["activity"], user: string, action: string, summary?: string) {
  return [{ ts: nowIso(), user, action, ...(summary ? { summary } : {}) }, ...list];
}

const DIM_ROWS = (v: unknown): ScopeDimRow[] => (Array.isArray(v) ? v.map((r) => {
  const rec = r as Record<string, unknown>;
  return { name: String(rec.name ?? ""), status: SCOPE_DSTAT.includes(rec.status as never) ? String(rec.status) : "Included", note: String(rec.note ?? ""), ...(rec.cat ? { cat: String(rec.cat) } : {}) };
}).filter((r) => r.name) : []);

function validateNotes(dims: Record<string, ScopeDimRow[]>) {
  for (const key of SCOPE_DIMS) {
    for (const row of dims[key] ?? []) {
      if ((row.status === "Excluded" || row.status === "Partially Included") && !row.note.trim()) {
        throw new BadRequestError(`"${row.name}" is ${row.status} and needs a justification note`, "NOTE_REQUIRED");
      }
    }
  }
}
function dimsOf(input: Record<string, unknown>): Record<string, ScopeDimRow[]> {
  const out: Record<string, ScopeDimRow[]> = {};
  for (const k of SCOPE_DIMS) out[k] = DIM_ROWS(input[k]);
  return out;
}
function scopeDims(s: MsScope): Record<string, ScopeDimRow[]> {
  return { frameworks: s.frameworks, sites: s.sites, processes: s.processes, envs: s.envs, personnel: s.personnel, deps: s.deps };
}
function computeCounts(dims: Record<string, ScopeDimRow[]>): ScopeCounts {
  return { standards: (dims.frameworks ?? []).filter(inScope).length, sites: (dims.sites ?? []).filter(inScope).length, users: (dims.personnel ?? []).filter(inScope).length };
}
function frameworkRelevance(dims: Record<string, ScopeDimRow[]>): string[] {
  return (dims.frameworks ?? []).filter(inScope).map((r) => r.name);
}

async function generateStatement(orgId: string, dims: Record<string, ScopeDimRow[]>): Promise<string> {
  const org = await Organization.findByPk(orgId);
  const names = (k: string) => (dims[k] ?? []).filter(inScope).map((r) => r.name);
  const fw = names("frameworks"), proc = names("processes"), sites = names("sites");
  let s = `The management system applies to ${fw.join(" and ") || "the applicable standards"}, covering ${proc.join(", ") || "the organization's business processes"} performed by ${org?.name ?? "the organization"} at ${sites.join(", ") || "its sites"}.`;
  const pers = names("personnel"), env = names("envs"), dep = names("deps");
  if (pers.length || env.length || dep.length) {
    s += ` The scope includes ${pers.join(", ")}${pers.length && (env.length || dep.length) ? "; " : ""}${env.join(", ")}${env.length && dep.length ? "; " : ""}${dep.length ? `externally provided services including ${dep.join(", ")}` : ""}.`;
  }
  return s;
}

/**
 * OD `msGenStatement` (9986): the scope form's "Generate draft" button —
 * compose a draft scope statement from the picked dimensions without
 * persisting anything. The FE derives the limitations draft client-side from
 * the noted rows, exactly like OD.
 */
export async function generateStatementPreview(auth: AuthContext, input: Record<string, unknown>, orgId?: string) {
  const org = await targetOrg(auth, orgId);
  return { statement: await generateStatement(org, dimsOf(input)) };
}

// --- CRUD ---------------------------------------------------------------
export async function listScopes(auth: AuthContext) {
  const ids = await visibleTenantOrgIds(auth);
  const where = ids === null ? {} : { orgId: { [Op.in]: ids } };
  return (await MsScope.findAll({ where, order: [["version", "DESC"], ["createdAt", "DESC"]] })).map((r) => r.get({ plain: true }));
}
export async function getScope(auth: AuthContext, id: string) {
  const row = await MsScope.findByPk(id);
  if (!row) throw new NotFoundError("Scope not found", "SCOPE_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row.get({ plain: true });
}
export async function createScope(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const name = str(input.name);
  if (!name) throw new BadRequestError("Scope name is required", "NAME_REQUIRED");
  const dims = dimsOf(input);
  validateNotes(dims);
  const who = await actorName(auth);
  // The scope's own id is its lineage root; every future spApprove clone of
  // this scope carries the same lineageId so version history stays linkable
  // once each clone gets its own new `code` (see migration 0041).
  const id = randomUUID();
  const row = await MsScope.create({
    id, lineageId: id, orgId: org, code: await nextCode(), name, owner: str(input.owner) ?? "Tenant Administrator",
    effectiveDate: str(input.effectiveDate), reviewFreq: str(input.reviewFreq) || "Annually", status: "Draft",
    ...dims, statement: str(input.statement) ?? await generateStatement(org, dims), limitations: str(input.limitations),
    approvalNotes: str(input.approvalNotes), frameworkRelevance: frameworkRelevance(dims), version: 1,
    createdBy: who, activity: [{ ts: nowIso(), user: who, action: "created", summary: "Scope drafted" }],
  });
  await audit(auth, org, "scope.created", row.id, ip);
  return row.get({ plain: true });
}
async function requireScope(auth: AuthContext, id: string): Promise<MsScope> {
  const row = await MsScope.findByPk(id);
  if (!row) throw new NotFoundError("Scope not found", "SCOPE_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row;
}
export async function updateScope(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireScope(auth, id);
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.owner !== undefined) row.owner = str(input.owner);
  if (input.effectiveDate !== undefined) row.effectiveDate = str(input.effectiveDate);
  if (input.reviewFreq !== undefined) row.reviewFreq = str(input.reviewFreq) || "Annually";
  if (input.limitations !== undefined) row.limitations = str(input.limitations);
  if (input.approvalNotes !== undefined) row.approvalNotes = str(input.approvalNotes);
  const dimsProvided = SCOPE_DIMS.some((k) => input[k] !== undefined);
  if (dimsProvided) {
    const dims = dimsOf({ ...scopeDims(row), ...input });
    validateNotes(dims);
    row.frameworks = dims.frameworks; row.sites = dims.sites; row.processes = dims.processes; row.envs = dims.envs; row.personnel = dims.personnel; row.deps = dims.deps;
    row.frameworkRelevance = frameworkRelevance(dims);
    row.statement = str(input.statement) ?? await generateStatement(row.orgId, dims);
  } else if (input.statement !== undefined) row.statement = str(input.statement);
  const who = await actorName(auth);
  // OD's msSave (10074) bumps `version` on every edit of an existing scope
  // (`s.version=(s.version||1)+1`); mirror that here (S11).
  row.version = (row.version ?? 1) + 1;
  row.activity = pushActivity(row.activity, who, "updated", `Scope updated · v${row.version}`);
  await row.save();
  await audit(auth, row.orgId, "scope.updated", row.id, ip);
  return row.get({ plain: true });
}

// --- Lifecycle ----------------------------------------------------------
export async function approveScope(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  if (row.status === "Approved" || row.status === "Active") throw new ConflictError("Scope is already approved", "ALREADY_APPROVED");
  const who = await actorName(auth);
  row.status = "Approved"; row.approvedBy = who; row.approvedDate = today();
  row.activity = pushActivity(row.activity, who, "approved", "Scope approved");
  await row.save();
  await audit(auth, row.orgId, "scope.approved", row.id, ip);
  return row.get({ plain: true });
}
export async function activateScope(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  const who = await actorName(auth);
  // Supersede any other Active scope for this org.
  const others = await MsScope.findAll({ where: { orgId: row.orgId, status: "Active", id: { [Op.ne]: row.id } } });
  for (const o of others) { o.status = "Superseded"; o.supersededBy = who; o.supersededAt = nowIso(); o.supersededByVersion = row.version; await o.save(); }
  if (!row.approvedBy) { row.approvedBy = who; row.approvedDate = today(); }
  row.status = "Active";
  const dims = scopeDims(row);
  if (!row.baseline) row.baseline = { version: row.version, capturedAt: row.approvedDate ?? row.effectiveDate ?? today(), capturedBy: row.approvedBy ?? who, counts: computeCounts(dims), snapshot: dims };
  row.activity = pushActivity(row.activity, who, "activated", "Scope set as active");
  await row.save();
  await audit(auth, row.orgId, "scope.activated", row.id, ip);
  return row.get({ plain: true });
}
export async function archiveScope(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  const who = await actorName(auth);
  row.status = "Archived";
  row.activity = pushActivity(row.activity, who, "archived", "Scope archived");
  await row.save();
  await audit(auth, row.orgId, "scope.archived", row.id, ip);
  return row.get({ plain: true });
}

// --- Baseline + billable diff + Partner→SP re-baseline ------------------
/** Diff the baseline snapshot's in-scope sets against the current dimensions. */
function diff(base: Record<string, ScopeDimRow[]>, cur: Record<string, ScopeDimRow[]>): ScopeDiffEntry[] {
  const meter: Record<string, { kind: string; billable: boolean }> = {
    frameworks: { kind: "Standard", billable: true }, sites: { kind: "Site", billable: true }, personnel: { kind: "User", billable: true },
    processes: { kind: "Process", billable: false }, envs: { kind: "Environment", billable: false }, deps: { kind: "Dependency", billable: false },
  };
  const out: ScopeDiffEntry[] = [];
  for (const k of SCOPE_DIMS) {
    const b = new Set((base[k] ?? []).filter(inScope).map((r) => r.name));
    const c = new Set((cur[k] ?? []).filter(inScope).map((r) => r.name));
    for (const name of c) if (!b.has(name)) out.push({ billable: meter[k].billable, kind: meter[k].kind, action: "Added", label: name });
    for (const name of b) if (!c.has(name)) out.push({ billable: meter[k].billable, kind: meter[k].kind, action: "Removed", label: name });
  }
  return out;
}
export async function scopeDiff(auth: AuthContext, id: string) {
  const row = await requireScope(auth, id);
  if (!row.baseline) return { baselineCounts: null, currentCounts: computeCounts(scopeDims(row)), entries: [] };
  const entries = diff(row.baseline.snapshot, scopeDims(row));
  return { baselineCounts: row.baseline.counts, currentCounts: computeCounts(scopeDims(row)), entries, pendingChange: row.pendingChange };
}
export async function submitChanges(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  if (!row.baseline) throw new BadRequestError("Scope has no baseline yet (activate it first)", "NO_BASELINE");
  if (row.pendingChange) throw new ConflictError("A change request is already in progress", "PENDING_EXISTS");
  const entries = diff(row.baseline.snapshot, scopeDims(row));
  if (entries.length === 0) throw new BadRequestError("No pending changes to submit", "NO_CHANGES");
  const who = await actorName(auth);
  row.pendingChange = { stage: "partner", raisedBy: who, raisedAt: nowIso(), entries, snapshot: scopeDims(row) };
  row.activity = pushActivity(row.activity, who, "changes-submitted", "Scope changes submitted → Partner review");
  await row.save();
  await audit(auth, row.orgId, "scope.changesSubmitted", row.id, ip);
  return row.get({ plain: true });
}
export async function partnerApprove(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  if (row.pendingChange?.stage !== "partner") throw new ConflictError("No change awaiting partner approval", "NOT_PARTNER_STAGE");
  const who = await actorName(auth);
  row.pendingChange = { ...row.pendingChange, stage: "sp", partnerBy: who, partnerAt: nowIso() };
  row.activity = pushActivity(row.activity, who, "partner-approved", "Partner approved → escalated to Service Provider");
  await row.save();
  await audit(auth, row.orgId, "scope.partnerApproved", row.id, ip);
  return row.get({ plain: true });
}
export async function spApprove(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  if (row.pendingChange?.stage !== "sp") throw new ConflictError("No change awaiting Service Provider approval", "NOT_SP_STAGE");
  const who = await actorName(auth);
  const snap = row.pendingChange.snapshot;
  const pv = row.baseline?.version ?? row.version ?? 1;
  const nv = pv + 1;
  // Clone the prior version as a superseded record. It gets a brand-new
  // `code` (nextCode) but keeps the same `lineageId` as the active scope it
  // was cloned from, so the Versions tab can find it (S6 — see migration
  // 0041; filtering on `code` equality can never work since the clone's code
  // always differs).
  const plain = row.get({ plain: true });
  await MsScope.create({
    lineageId: row.lineageId, orgId: row.orgId, code: await nextCode(), name: plain.name, owner: plain.owner, effectiveDate: plain.effectiveDate,
    reviewFreq: plain.reviewFreq, status: "Superseded",
    frameworks: (row.baseline?.snapshot.frameworks ?? row.frameworks), sites: (row.baseline?.snapshot.sites ?? row.sites),
    processes: (row.baseline?.snapshot.processes ?? row.processes), envs: (row.baseline?.snapshot.envs ?? row.envs),
    personnel: (row.baseline?.snapshot.personnel ?? row.personnel), deps: (row.baseline?.snapshot.deps ?? row.deps),
    statement: plain.statement, limitations: plain.limitations, frameworkRelevance: plain.frameworkRelevance,
    approvedBy: plain.approvedBy, approvedDate: plain.approvedDate, version: pv, baseline: row.baseline,
    supersededAt: nowIso(), supersededBy: who, supersededByVersion: nv, createdBy: plain.createdBy, activity: plain.activity,
  });
  // Re-baseline the active scope to the new version.
  row.baseline = { version: nv, capturedAt: nowIso(), capturedBy: who, counts: computeCounts(snap), snapshot: snap };
  row.version = nv; row.status = "Active"; row.pendingChange = null; row.approvedBy = who; row.approvedDate = today();
  row.activity = pushActivity(row.activity, who, "re-baselined", `Scope re-baselined · v${pv}.0 superseded → v${nv}.0`);
  await row.save();
  await audit(auth, row.orgId, "scope.reBaselined", row.id, ip);
  return row.get({ plain: true });
}
export async function rejectChange(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireScope(auth, id);
  if (!row.pendingChange) throw new BadRequestError("No change to reject", "NO_PENDING");
  const who = await actorName(auth);
  row.pendingChange = null;
  row.activity = pushActivity(row.activity, who, "changes-rejected", "Scope changes rejected · returned to tenant");
  await row.save();
  await audit(auth, row.orgId, "scope.changesRejected", row.id, ip);
  return row.get({ plain: true });
}

export const SCOPE_STATUSES = MS_SCOPESTAT;
