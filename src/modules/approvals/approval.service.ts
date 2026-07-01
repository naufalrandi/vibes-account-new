import { Op } from "sequelize";
import {
  ApprovalScheme, ApprovalModuleMap, ApprovalPoolMember, ApprovalRecord, ApprovalSettings,
  User, ImplementationRecord,
} from "../../db/models";
import { AP_POOLS, type SchemeGate, type RuntimeGate } from "../../db/models/approval.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

const nowIso = () => new Date().toISOString();
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));

// ---- Built-in schemes (defined in code, always present) ----
export interface SchemeView { id: string; name: string; kind: string; selfServe: boolean; description: string | null; gates: SchemeGate[] }
function builtins(): SchemeView[] {
  return [
    { id: "S0", name: "Single Review", kind: "builtin", selfServe: false, description: "One MS Team review that also publishes. For lower-risk items.", gates: [{ label: "MS Team Review", pool: "mst", isFinalGate: true }] },
    { id: "S1", name: "Two-Gate Approval", kind: "builtin", selfServe: false, description: "MS Team reviews first, then Top Management gives the final sign-off that publishes. The default for governance documents.", gates: [{ label: "MS Team Review", pool: "mst", isFinalGate: false }, { label: "Top Management", pool: "top", isFinalGate: true }] },
    { id: "S2", name: "Self-Serve", kind: "builtin", selfServe: true, description: "The author publishes directly, no separate approver. Self-approval is recorded in the audit trail.", gates: [] },
  ];
}

export const AP_DEFAULT_MAP: Record<string, string> = {
  policies: "S1", context: "S1", parties: "S1", objectives: "S1", compliance: "S1", risks: "S1", scope: "S1", reviews: "S1",
  awareness: "S0", documents: "S0", records: "S0", competence: "S0",
};

/** Governed register modules whose BE status set supports the engine transitions. */
const GOVERNED: Record<string, { submit: string; mid: string; final: string; revision: string; draft: string }> = {
  policies: { submit: "Under Review", mid: "Pending Final Approval", final: "Published", revision: "Needs Revision", draft: "Draft" },
  context: { submit: "Open", mid: "Open", final: "Monitored", revision: "Open", draft: "Open" },
};

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}
async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}

// ---- Schemes ----
export async function listSchemes(auth: AuthContext): Promise<SchemeView[]> {
  const custom = await ApprovalScheme.findAll({ where: { orgId: auth.orgId }, order: [["code", "ASC"]] });
  return [...builtins(), ...custom.map((c) => ({ id: c.code, name: c.name, kind: "custom", selfServe: c.selfServe, description: c.description, gates: c.gates }))];
}
async function nextSchemeCode(orgId: string): Promise<string> {
  const rows = await ApprovalScheme.findAll({ where: { orgId }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) { const n = Number.parseInt(r.code.replace(/^C/, ""), 10); if (Number.isFinite(n) && n > max) max = n; }
  return `C${max + 1}`;
}
function normGates(input: unknown): SchemeGate[] {
  const arr = Array.isArray(input) ? input : [];
  if (arr.length === 0) throw new BadRequestError("Add at least one gate", "GATES_REQUIRED");
  if (arr.length > 5) throw new BadRequestError("A scheme can have at most 5 gates", "TOO_MANY_GATES");
  return arr.map((g, i) => {
    const rec = g as Record<string, unknown>;
    const label = str(rec.label);
    const pool = str(rec.pool) ?? "mst";
    if (!label) throw new BadRequestError(`Gate ${i + 1} needs a label`, "GATE_LABEL_REQUIRED");
    if (!AP_POOLS.includes(pool as never)) throw new BadRequestError(`Gate ${i + 1} has an invalid pool`, "INVALID_POOL");
    return { label, pool, isFinalGate: i === arr.length - 1 };
  });
}
export async function createScheme(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const name = str(input.name);
  if (!name) throw new BadRequestError("Scheme name is required", "NAME_REQUIRED");
  const gates = normGates(input.gates);
  const row = await ApprovalScheme.create({ orgId: auth.orgId, code: await nextSchemeCode(auth.orgId), name, kind: "custom", selfServe: false, description: str(input.description), gates });
  await audit(auth, "approval.scheme.created", "ApprovalScheme", row.id, ip);
  return { id: row.code, name: row.name, kind: "custom", selfServe: false, description: row.description, gates: row.gates };
}
export async function updateScheme(auth: AuthContext, code: string, input: Record<string, unknown>, ip: string | null) {
  const row = await ApprovalScheme.findOne({ where: { orgId: auth.orgId, code } });
  if (!row) throw new NotFoundError("Custom scheme not found", "SCHEME_NOT_FOUND");
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.description !== undefined) row.description = str(input.description);
  if (input.gates !== undefined) row.gates = normGates(input.gates);
  await row.save();
  await audit(auth, "approval.scheme.updated", "ApprovalScheme", row.id, ip);
  return { id: row.code, name: row.name, kind: "custom", selfServe: false, description: row.description, gates: row.gates };
}
export async function deleteScheme(auth: AuthContext, code: string, ip: string | null) {
  const row = await ApprovalScheme.findOne({ where: { orgId: auth.orgId, code } });
  if (!row) throw new NotFoundError("Custom scheme not found", "SCHEME_NOT_FOUND");
  await ApprovalModuleMap.destroy({ where: { orgId: auth.orgId, schemeId: code } }); // fall back to default
  await row.destroy();
  await audit(auth, "approval.scheme.deleted", "ApprovalScheme", row.id, ip);
}

// ---- Module → scheme map ----
export async function getModuleMap(auth: AuthContext): Promise<Record<string, string>> {
  const rows = await ApprovalModuleMap.findAll({ where: { orgId: auth.orgId } });
  const out: Record<string, string> = { ...AP_DEFAULT_MAP };
  for (const r of rows) out[r.moduleKey] = r.schemeId;
  return out;
}
export async function resolveSchemeId(auth: AuthContext, moduleKey: string): Promise<string> {
  const row = await ApprovalModuleMap.findOne({ where: { orgId: auth.orgId, moduleKey } });
  return row?.schemeId ?? AP_DEFAULT_MAP[moduleKey] ?? "S0";
}
export async function setModuleScheme(auth: AuthContext, moduleKey: string, schemeId: string, ip: string | null) {
  const schemes = await listSchemes(auth);
  if (!schemes.some((s) => s.id === schemeId)) throw new BadRequestError("Unknown scheme", "SCHEME_UNKNOWN");
  const [row] = await ApprovalModuleMap.findOrCreate({ where: { orgId: auth.orgId, moduleKey }, defaults: { orgId: auth.orgId, moduleKey, schemeId } });
  if (row.schemeId !== schemeId) { row.schemeId = schemeId; await row.save(); }
  await audit(auth, "approval.moduleMap.set", "ApprovalModuleMap", row.id, ip);
  return { moduleKey, schemeId };
}

// ---- Pool members ----
export interface PoolMemberView { userId: string; fullName: string; isMST: boolean; mstPriority: string; isTM: boolean; tmFinal: boolean }
export async function listPoolMembers(auth: AuthContext): Promise<PoolMemberView[]> {
  const users = await User.findAll({ where: { orgId: auth.orgId }, attributes: ["id", "fullName"] });
  const flags = new Map((await ApprovalPoolMember.findAll({ where: { orgId: auth.orgId } })).map((f) => [f.userId, f]));
  return users.map((u) => {
    const f = flags.get(u.id);
    return { userId: u.id, fullName: u.fullName, isMST: f?.isMST ?? false, mstPriority: f?.mstPriority ?? "required", isTM: f?.isTM ?? false, tmFinal: f?.tmFinal ?? false };
  });
}
export async function setPoolMember(auth: AuthContext, userId: string, input: Record<string, unknown>, ip: string | null) {
  const user = await User.findOne({ where: { id: userId, orgId: auth.orgId } });
  if (!user) throw new NotFoundError("User not found", "USER_NOT_FOUND");
  const [row] = await ApprovalPoolMember.findOrCreate({ where: { orgId: auth.orgId, userId }, defaults: { orgId: auth.orgId, userId } });
  if (typeof input.isMST === "boolean") row.isMST = input.isMST;
  if (typeof input.mstPriority === "string" && ["required", "optional"].includes(input.mstPriority)) row.mstPriority = input.mstPriority;
  if (typeof input.isTM === "boolean") { row.isTM = input.isTM; if (!input.isTM) row.tmFinal = false; }
  if (typeof input.tmFinal === "boolean") row.tmFinal = input.tmFinal && row.isTM;
  await row.save();
  await audit(auth, "approval.pool.set", "ApprovalPoolMember", row.id, ip);
  return { userId, fullName: user.fullName, isMST: row.isMST, mstPriority: row.mstPriority, isTM: row.isTM, tmFinal: row.tmFinal };
}

// ---- Settings ----
export async function getSettings(auth: AuthContext) {
  const [row] = await ApprovalSettings.findOrCreate({ where: { orgId: auth.orgId }, defaults: { orgId: auth.orgId } });
  return { selfApprovalAllowed: row.selfApprovalAllowed };
}
export async function setSelfApproval(auth: AuthContext, allowed: boolean, ip: string | null) {
  const [row] = await ApprovalSettings.findOrCreate({ where: { orgId: auth.orgId }, defaults: { orgId: auth.orgId } });
  row.selfApprovalAllowed = allowed;
  await row.save();
  await audit(auth, "approval.settings.set", "ApprovalSettings", row.id, ip);
  return { selfApprovalAllowed: row.selfApprovalAllowed };
}

// ---- Pool resolution ----
async function poolNames(orgId: string, pool: string): Promise<{ eligible: string[]; required: string[] }> {
  const flags = await ApprovalPoolMember.findAll({ where: { orgId, [pool === "mst" ? "isMST" : "isTM"]: true } });
  const ids = flags.map((f) => f.userId);
  const users = new Map((await User.findAll({ where: { id: { [Op.in]: ids.length ? ids : ["00000000-0000-0000-0000-000000000000"] } }, attributes: ["id", "fullName"] })).map((u) => [u.id, u.fullName]));
  const eligible = flags.map((f) => users.get(f.userId) ?? "").filter(Boolean);
  let required: string[];
  if (pool === "mst") required = flags.filter((f) => f.mstPriority !== "optional").map((f) => users.get(f.userId) ?? "").filter(Boolean);
  else required = flags.filter((f) => f.tmFinal).map((f) => users.get(f.userId) ?? "").filter(Boolean);
  if (required.length === 0) required = [...eligible]; // fallback: all members required
  return { eligible, required };
}
async function buildApproval(auth: AuthContext, scheme: SchemeView): Promise<RuntimeGate[]> {
  const gates: RuntimeGate[] = [];
  for (const g of scheme.gates) {
    const { eligible, required } = await poolNames(auth.orgId, g.pool);
    gates.push({ pool: g.pool, label: g.label, isFinalGate: g.isFinalGate, required, eligible, approvals: [] });
  }
  return gates;
}
function gateDone(g: RuntimeGate): boolean {
  const signed = new Set(g.approvals.map((a) => a.by));
  const allRequired = g.required.every((r) => signed.has(r));
  return allRequired && (g.required.length > 0 || g.approvals.length > 0);
}
/** Whether `who` may sign the active gate — returns an error message if not, else null. */
function approveBlockReason(gates: RuntimeGate[], gateIdx: number, who: string, author: string, selfAllowed: boolean): string | null {
  const g = gates[gateIdx];
  if (!g) return "No active gate.";
  if (!g.eligible.includes(who)) return `This gate is approved by the ${g.pool === "mst" ? "MS Team" : "Top Management"}.`;
  if (g.approvals.some((a) => a.by === who)) return "You have already approved this gate.";
  if (who === author && !selfAllowed) return "Self-approval is disabled — approval must be by someone other than the author.";
  // SoD: signed an earlier gate → block unless the only remaining eligible signer.
  const signedEarlier = gates.slice(0, gateIdx).some((eg) => eg.approvals.some((a) => a.by === who));
  if (signedEarlier) {
    const others = g.eligible.filter((e) => e !== who && !g.approvals.some((a) => a.by === e));
    if (others.length) return "Separation of duties — you already approved an earlier gate.";
  }
  return null;
}

async function governedRecord(auth: AuthContext, module: string, recordId: string): Promise<ImplementationRecord> {
  const rec = await ImplementationRecord.findOne({ where: { id: recordId, module, orgId: auth.orgId } });
  if (!rec) throw new NotFoundError("Governed record not found", "RECORD_NOT_FOUND");
  return rec;
}
function requireGoverned(module: string) {
  const cfg = GOVERNED[module];
  if (!cfg) throw new BadRequestError(`Module "${module}" is not governed by the approval engine`, "MODULE_NOT_GOVERNED");
  return cfg;
}
function recView(r: ApprovalRecord) {
  return { module: r.module, recordId: r.recordId, schemeId: r.schemeId, schemeName: r.schemeName, selfServe: r.selfServe, gateIdx: r.gateIdx, gates: r.gates, authorName: r.authorName, state: r.state };
}

export async function getApproval(auth: AuthContext, module: string, recordId: string) {
  const r = await ApprovalRecord.findOne({ where: { orgId: auth.orgId, module, recordId } });
  return r ? recView(r) : null;
}

/** Submit a governed record into its assigned scheme (or self-serve publish). */
export async function submit(auth: AuthContext, module: string, recordId: string, ip: string | null) {
  const cfg = requireGoverned(module);
  const rec = await governedRecord(auth, module, recordId);
  const schemeId = await resolveSchemeId(auth, module);
  const scheme = (await listSchemes(auth)).find((s) => s.id === schemeId);
  if (!scheme) throw new BadRequestError("Assigned scheme not found", "SCHEME_MISSING");
  const who = await actorName(auth);
  if (scheme.selfServe) {
    rec.status = cfg.final;
    rec.data = { ...rec.data, approvedBy: who, approvedDate: nowIso().slice(0, 10) };
    await rec.save();
    await audit(auth, "approval.selfServe.published", "ImplementationRecord", rec.id, ip);
    return { record: null, status: rec.status };
  }
  const gates = await buildApproval(auth, scheme);
  const empty = gates.find((g) => g.eligible.length === 0);
  if (empty) throw new BadRequestError(`No ${empty.pool === "mst" ? "MS Team" : "Top Management"} approver is configured for this scheme. Assign one under Approvals.`, "POOL_EMPTY");
  const existing = await ApprovalRecord.findOne({ where: { orgId: auth.orgId, module, recordId } });
  if (existing && existing.state === "active") throw new ConflictError("Record is already under review", "ALREADY_SUBMITTED");
  const ar = existing ?? ApprovalRecord.build({ orgId: auth.orgId, module, recordId, schemeId: scheme.id, schemeName: scheme.name });
  ar.schemeId = scheme.id; ar.schemeName = scheme.name; ar.selfServe = false; ar.gateIdx = 0; ar.gates = gates; ar.authorName = who; ar.state = "active";
  await ar.save();
  rec.status = cfg.submit;
  rec.data = { ...rec.data, approvedBy: null, approvedDate: null };
  await rec.save();
  await audit(auth, "approval.submitted", "ImplementationRecord", rec.id, ip);
  return { record: recView(ar), status: rec.status };
}

export async function approve(auth: AuthContext, module: string, recordId: string, ip: string | null) {
  const cfg = requireGoverned(module);
  const ar = await ApprovalRecord.findOne({ where: { orgId: auth.orgId, module, recordId, state: "active" } });
  if (!ar) throw new NotFoundError("No active approval for this record", "NO_APPROVAL");
  const rec = await governedRecord(auth, module, recordId);
  const who = await actorName(auth);
  const { selfApprovalAllowed } = await getSettings(auth);
  const reason = approveBlockReason(ar.gates, ar.gateIdx, who, ar.authorName ?? "", selfApprovalAllowed);
  if (reason) throw new ForbiddenError(reason);
  const gates = ar.gates.map((g) => ({ ...g, approvals: [...g.approvals] }));
  gates[ar.gateIdx].approvals.push({ by: who, at: nowIso() });
  const active = gates[ar.gateIdx];
  let result: "open" | "advanced" | "final" = "open";
  if (gateDone(active)) {
    if (active.isFinalGate || ar.gateIdx >= gates.length - 1) {
      result = "final";
      ar.state = "approved";
      rec.status = cfg.final;
      rec.data = { ...rec.data, approvedBy: who, approvedDate: nowIso().slice(0, 10) };
      await rec.save();
    } else {
      result = "advanced";
      ar.gateIdx += 1;
      rec.status = cfg.mid;
      await rec.save();
    }
  }
  ar.gates = gates;
  await ar.save();
  await audit(auth, "approval.approved", "ImplementationRecord", rec.id, ip);
  return { record: recView(ar), status: rec.status, result };
}

export async function requestRevision(auth: AuthContext, module: string, recordId: string, ip: string | null) {
  const cfg = requireGoverned(module);
  const rec = await governedRecord(auth, module, recordId);
  rec.status = cfg.revision;
  await rec.save();
  await ApprovalRecord.destroy({ where: { orgId: auth.orgId, module, recordId } });
  await audit(auth, "approval.revisionRequested", "ImplementationRecord", rec.id, ip);
  return { status: rec.status };
}

export async function withdraw(auth: AuthContext, module: string, recordId: string, ip: string | null) {
  const cfg = requireGoverned(module);
  const ar = await ApprovalRecord.findOne({ where: { orgId: auth.orgId, module, recordId, state: "active" } });
  if (!ar) throw new NotFoundError("No active approval to withdraw", "NO_APPROVAL");
  const who = await actorName(auth);
  if (ar.authorName && ar.authorName !== who) throw new ForbiddenError("Only the submitter can withdraw this record.");
  if (ar.gates.some((g) => g.approvals.length > 0)) throw new ConflictError("Cannot withdraw after an approver has signed.", "ALREADY_SIGNED");
  const rec = await governedRecord(auth, module, recordId);
  rec.status = cfg.draft;
  await rec.save();
  await ar.destroy();
  await audit(auth, "approval.withdrawn", "ImplementationRecord", rec.id, ip);
  return { status: rec.status };
}
