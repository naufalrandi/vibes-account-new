import { Op } from "sequelize";
import {
  ApprovalScheme, ApprovalModuleMap, ApprovalPoolMember, ApprovalRecord, ApprovalSettings,
  User, ImplementationRecord, IpRequirement,
} from "../../db/models";
import { AP_POOLS, type SchemeGate, type RuntimeGate } from "../../db/models/approval.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { logActivity } from "../record-events/recordEvent.service";
import { CD_FREQ_MO, getDocSettings } from "../implementation/documentControl";
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

/**
 * Explicit non-default approval-scheme overrides — OD `AP_DEFAULT_MAP`
 * (app.html:10355), `AP_DEFAULT_MAP[k]||'S0'`. A module with no entry here
 * defaults to "S0" (OD's own fallback), whether or not this BE has ever heard
 * of that module key before.
 *
 * This is deliberately the ONLY governed-module data this backend owns. Wave
 * P task P-1.5 removed the enumerated `AP_MODULE_KEYS` list that used to sit
 * alongside this map: it was a hand-maintained mirror of the frontend's
 * nav-derived `AP_MODULE_GROUPS` (`lib/api/types.ts`), and the two had
 * already drifted twice (P-1.4 found two invented modules with no OD
 * counterpart; a follow-up audit found the grouping itself had diverged from
 * the nav). This backend has no nav config to derive an equivalent list from,
 * and its own module registry (`implementation/registry.ts`) doesn't cover
 * every governed key either (`scope`, `competence`, `instruments`,
 * `assessments`, `audits` aren't clause-register modules) — so re-deriving a
 * second enumeration here would just relocate the hand-maintenance burden,
 * not remove it. Instead the frontend's nav is treated as the sole contract:
 * `setModuleScheme` below accepts any module key at all, matching OD's own
 * `apSetModuleScheme` (app.html:16231), which performs no key-membership
 * check either — it just writes `t.moduleApproval[k]=id` for whatever key the
 * (nav-driven) UI passes. A backend that 400s on a module the frontend
 * renders is worse than the drift this removal fixes.
 */
export const AP_DEFAULT_MAP: Record<string, string> = {
  policies: "S1", context: "S1", parties: "S1", objectives: "S1", compliance: "S1", risks: "S1", scope: "S1", reviews: "S1",
  awareness: "S0", documents: "S0", records: "S0", competence: "S0",
};

/**
 * OD `polPublishCore` / `cdPublish`: publishing a policy or controlled document
 * is not just a status flip. It supersedes the previously published version
 * *in the same lineage* (so only one version is ever live), stamps the
 * publication, defaults the effective date, and derives `nextReview` from the
 * review frequency when it was left blank. Cadence months come from
 * `CD_FREQ_MO` (a superset of the policies map — adds "Every 3 years").
 *
 * Lineage is `data.lineageId` falling back to the record's own id, matching OD
 * — a first-generation record is the root of its own lineage.
 */
async function publishWithLineage(
  _auth: AuthContext, rec: ImplementationRecord, who: string,
): Promise<void> {
  const data = (rec.data ?? {}) as Record<string, unknown>;
  const lineage = (data.lineageId as string) ?? rec.id;
  const now = nowIso();

  const siblings = await ImplementationRecord.findAll({
    where: { orgId: rec.orgId, module: rec.module, status: "Published" },
  });
  const prior = siblings.find(
    (x) => x.id !== rec.id && (((x.data ?? {}) as Record<string, unknown>).lineageId ?? x.id) === lineage,
  );
  if (prior) {
    prior.status = "Superseded";
    prior.data = { ...(prior.data ?? {}), supersededBy: rec.id };
    await prior.save();
  }

  const effectiveDate = (data.effectiveDate as string) || now;
  let nextReview = data.nextReview as string | undefined;
  if (!nextReview) {
    const months = CD_FREQ_MO[String(data.reviewFreq ?? "")] ?? 12;
    const d = new Date(effectiveDate);
    d.setMonth(d.getMonth() + months);
    nextReview = d.toISOString();
  }

  rec.data = {
    ...data, lineageId: lineage, publishedBy: who, publishedDate: now,
    effectiveDate, nextReview, ...(prior ? { supersedes: prior.id } : {}),
  };
}

/**
 * OD `polPublishCore` activity trail: the publish entry on the new version and
 * the "policy superseded — replaced by …" entry on the prior version in the
 * same lineage (which `publishWithLineage` just flipped to Superseded and
 * recorded on `rec.data.supersedes`).
 */
async function logPolicyPublished(auth: AuthContext, rec: ImplementationRecord, text: string): Promise<void> {
  const superseded = ((rec.data ?? {}) as Record<string, unknown>).supersedes as string | undefined;
  await logActivity(auth, rec.orgId, rec.module, rec.id, superseded ? `${text} · superseded prior version` : text);
  if (superseded) {
    await logActivity(auth, rec.orgId, rec.module, superseded, `Policy superseded — replaced by ${rec.code}`);
  }
}

/** Governed register modules whose BE status set supports the engine transitions. */
const GOVERNED: Record<string, { submit: string; mid: string; final: string; revision: string; draft: string }> = {
  policies: { submit: "Under Review", mid: "Pending Final Approval", final: "Published", revision: "Needs Revision", draft: "Draft" },
  context: { submit: "Open", mid: "Open", final: "Monitored", revision: "Open", draft: "Open" },
  // Interested-party requirements (OD `apModuleSchemeFor('tn-m-parties')`,
  // 8871–8905): the Under Review → Addressed acceptance is what the scheme
  // gates. The governed row lives on its own IpRequirement table (not
  // ImplementationRecord) — see `governedRecord` / `stampOutcome`.
  parties: { submit: "Under Review", mid: "Under Review", final: "Addressed", revision: "Under Review", draft: "Open" },
  // Controlled documents deliberately do NOT route through the gate engine:
  // OD's cdocs flow is a bespoke 3-step lifecycle (submit → single-reviewer
  // decision Approve / Request Revision / Reject → explicit Publish) — see
  // submitDocument / reviewDocument / publishDocument below.
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
  // Seed with the explicit non-S0 overrides (OD 10355), then the org's stored
  // assignments on top. This BE has no enumerated "every governed module"
  // list to pre-seed further with (see the doc comment on AP_DEFAULT_MAP) —
  // any module without an override or a stored row simply isn't in this
  // response; the frontend already resolves that case to "S0" itself
  // (`moduleSchemeId`, `app/(app)/approvals/page.tsx`), matching OD's own
  // `apModuleSchemeId` fallback.
  const out: Record<string, string> = { ...AP_DEFAULT_MAP };
  for (const r of rows) out[r.moduleKey] = r.schemeId;
  return out;
}
export async function resolveSchemeId(auth: AuthContext, moduleKey: string): Promise<string> {
  const row = await ApprovalModuleMap.findOne({ where: { orgId: auth.orgId, moduleKey } });
  return row?.schemeId ?? AP_DEFAULT_MAP[moduleKey] ?? "S0";
}
export async function setModuleScheme(auth: AuthContext, moduleKey: string, schemeId: string, ip: string | null) {
  // No module-key membership check — see the doc comment on AP_DEFAULT_MAP
  // above. `moduleKey` is still required non-empty by the controller's zod
  // schema (`z.string().min(1)`); the scheme itself is still validated below.
  const schemes = await listSchemes(auth);
  if (!schemes.some((s) => s.id === schemeId)) throw new BadRequestError("Unknown scheme", "SCHEME_UNKNOWN");
  const [row] = await ApprovalModuleMap.findOrCreate({ where: { orgId: auth.orgId, moduleKey }, defaults: { orgId: auth.orgId, moduleKey, schemeId } });
  if (row.schemeId !== schemeId) { row.schemeId = schemeId; await row.save(); }
  await audit(auth, "approval.moduleMap.set", "ApprovalModuleMap", row.id, ip);
  return { moduleKey, schemeId };
}

// ---- Pool members ----

/**
 * OD parity (`apMigrateFlags`, index.html:4530-4536): OD self-heals an empty
 * approval pool on every `render()` — if a tenant has no MS Team member it
 * promotes an Administrator into the pool (falling back to injecting a
 * synthetic team member when no Administrator candidate exists) so gate
 * resolution always has someone to show. BE has no equivalent, which left a
 * fresh org's pool permanently empty (P0/B-series finding: "a fresh tenant
 * has an empty approval pool making every gated scheme unclearable" —
 * `poolNames`'s empty-pool fallback and the `submit()` "POOL_EMPTY" guard
 * above are the symptom).
 *
 * We port the same self-heal, scoped to the actual pool-read path
 * (`listPoolMembers`, the org's Approvals page) rather than every request:
 * idempotent, runs at most once per org (skips as soon as the org has *any*
 * `ApprovalPoolMember` row, seeded or user-set), and only ever *adds* rows —
 * it never edits or removes existing membership. Unlike OD's narrower
 * `hasTM && !hasMST` branch, we derive both pools from scratch (no BE
 * equivalent of OD's legacy `topMgmt` flag to read `hasTM` from), so an
 * empty pool gets a full working default: the earliest Administrator (or,
 * failing that, the org's earliest user) as MS Team (required), and a
 * second distinct user — when one exists — as the final-say Top Management
 * signer, so both S1 gates ("mst" and "top") resolve rather than only one.
 */
async function ensurePoolDefaults(orgId: string): Promise<void> {
  const existing = await ApprovalPoolMember.count({ where: { orgId } });
  if (existing > 0) return; // OD only self-heals a pool that has never been set up.
  const users = await User.findAll({ where: { orgId }, order: [["createdAt", "ASC"]], attributes: ["id", "position", "createdAt"] });
  if (users.length === 0) return;
  const isAdmin = (u: User): boolean => (u.position ?? "").toLowerCase().includes("administrator");
  const mst = users.find(isAdmin) ?? users[0];
  await ApprovalPoolMember.create({ orgId, userId: mst.id, isMST: true, mstPriority: "required", isTM: false, tmFinal: false });
  const tm = users.find((u) => u.id !== mst.id && isAdmin(u)) ?? users.find((u) => u.id !== mst.id);
  if (tm) await ApprovalPoolMember.create({ orgId, userId: tm.id, isMST: false, mstPriority: "required", isTM: true, tmFinal: true });
}

export interface PoolMemberView { userId: string; fullName: string; isMST: boolean; mstPriority: string; isTM: boolean; tmFinal: boolean }
export async function listPoolMembers(auth: AuthContext): Promise<PoolMemberView[]> {
  await ensurePoolDefaults(auth.orgId);
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

/**
 * The surface the gate engine needs from a governed row. Clause registers store
 * governed rows on ImplementationRecord; interested-party requirements live on
 * their own IpRequirement table (no `data` JSON), so the engine works against
 * this common shape and casts back only in module-specific branches.
 */
interface GovernedRow {
  id: string;
  orgId: string;
  code: string;
  status: string;
  data?: Record<string, unknown> | null;
  save(): Promise<unknown>;
}

async function governedRecord(auth: AuthContext, module: string, recordId: string): Promise<GovernedRow> {
  if (module === "parties") {
    const req = await IpRequirement.findOne({ where: { id: recordId, orgId: auth.orgId } });
    if (!req) throw new NotFoundError("Governed record not found", "RECORD_NOT_FOUND");
    return req;
  }
  const rec = await ImplementationRecord.findOne({ where: { id: recordId, module, orgId: auth.orgId } });
  if (!rec) throw new NotFoundError("Governed record not found", "RECORD_NOT_FOUND");
  return rec;
}

const entityTypeOf = (module: string): string => (module === "parties" ? "IpRequirement" : "ImplementationRecord");

/**
 * Stamp (or clear, when `who` is null) the approval outcome on a governed row.
 * Register rows keep it on `data.approvedBy/approvedDate`; interested-party
 * requirements record the acceptance on `decidedBy/decidedAt` plus an activity
 * entry, mirroring OD's `ipReqApprove` final branch (8875–8878).
 */
function stampOutcome(module: string, rec: GovernedRow, who: string | null): void {
  if (module === "parties") {
    const r = rec as unknown as IpRequirement;
    if (who) {
      r.decidedBy = who;
      r.decidedAt = nowIso();
      r.lastUpdatedBy = who;
      r.activity = [{ ts: nowIso(), user: who, action: "approved", summary: "Final approval — requirement addressed" }, ...r.activity];
    }
    return;
  }
  rec.data = who
    ? { ...rec.data, approvedBy: who, approvedDate: nowIso().slice(0, 10) }
    : { ...rec.data, approvedBy: null, approvedDate: null };
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
  // Controlled documents use OD's bespoke single-reviewer flow, not the gates.
  if (module === "documents") return submitDocument(auth, recordId, ip);
  const cfg = requireGoverned(module);
  const rec = await governedRecord(auth, module, recordId);
  // OD gates the *acceptance* of an Under Review requirement — submitting any
  // other state into the engine is a sequencing error (ipReqSubmitApproval 8871).
  if (module === "parties" && rec.status !== "Under Review") {
    throw new ConflictError("Submit the requirement for review first", "NOT_UNDER_REVIEW");
  }
  const schemeId = await resolveSchemeId(auth, module);
  const scheme = (await listSchemes(auth)).find((s) => s.id === schemeId);
  if (!scheme) throw new BadRequestError("Assigned scheme not found", "SCHEME_MISSING");
  const who = await actorName(auth);
  if (scheme.selfServe) {
    rec.status = cfg.final;
    stampOutcome(module, rec, who);
    // A self-serve scheme publishes immediately, so it supersedes the prior
    // version exactly as the gated path does.
    if (module === "policies") await publishWithLineage(auth, rec as ImplementationRecord, who);
    await rec.save();
    await audit(auth, "approval.selfServe.published", entityTypeOf(module), rec.id, ip);
    if (module === "policies") await logPolicyPublished(auth, rec as ImplementationRecord, "Published the policy — self-serve publish");
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
  stampOutcome(module, rec, null);
  await rec.save();
  await audit(auth, "approval.submitted", entityTypeOf(module), rec.id, ip);
  // OD `polSubmit` activity: "<scheme> — awaiting <first gate>".
  if (module === "policies") {
    await logActivity(auth, rec.orgId, module, rec.id, `Submitted for review — ${scheme.name} · awaiting ${gates[0]?.label ?? "review"}`);
  }
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
  // OD `polApprove` activity: pool sign-off with the Prioritized/Optional flag.
  if (module === "policies") {
    const prio = active.required.includes(who) ? "Prioritized" : "Optional";
    const self = who === (ar.authorName ?? "") ? " (self-approval)" : "";
    await logActivity(auth, rec.orgId, module, rec.id,
      `Approved · ${active.label} — ${active.pool === "mst" ? "MS Team" : "Top Management"} sign-off · ${prio} approver${self}`);
  }
  let result: "open" | "advanced" | "final" = "open";
  if (gateDone(active)) {
    if (active.isFinalGate || ar.gateIdx >= gates.length - 1) {
      result = "final";
      ar.state = "approved";
      rec.status = cfg.final;
      stampOutcome(module, rec, who);
      if (module === "policies") await publishWithLineage(auth, rec as ImplementationRecord, who);
      await rec.save();
      if (module === "policies") {
        await logPolicyPublished(auth, rec as ImplementationRecord, `Published the policy — final approval by ${active.pool === "mst" ? "MS Team" : "Top Management"}`);
      }
    } else {
      result = "advanced";
      ar.gateIdx += 1;
      rec.status = cfg.mid;
      await rec.save();
      if (module === "policies") {
        const next = gates[ar.gateIdx];
        await logActivity(auth, rec.orgId, module, rec.id, `Gate cleared — ${active.label} complete, advanced to ${next?.label ?? "final approval"}`);
      }
    }
  }
  ar.gates = gates;
  await ar.save();
  await audit(auth, "approval.approved", entityTypeOf(module), rec.id, ip);
  return { record: recView(ar), status: rec.status, result };
}

export async function requestRevision(auth: AuthContext, module: string, recordId: string, ip: string | null, comments?: string | null) {
  // Documents route through the bespoke review decision so the outcome and
  // comment land in the same fields the Review modal writes.
  if (module === "documents") return reviewDocument(auth, recordId, { decision: "Request Revision", comments }, ip);
  const cfg = requireGoverned(module);
  const rec = await governedRecord(auth, module, recordId);
  rec.status = cfg.revision;
  // Store the reviewer's comment on the record (OD keeps it on `reviewComments`);
  // previously the whole approval run was destroyed and the comment lost.
  // Party requirements have no `data` JSON — their comment lands in the
  // record-events activity line below only.
  const text = (comments ?? "").trim();
  if (text && module !== "parties") rec.data = { ...rec.data, reviewComments: text };
  await rec.save();
  await ApprovalRecord.update({ state: "returned" }, { where: { orgId: auth.orgId, module, recordId } });
  await audit(auth, "approval.revisionRequested", entityTypeOf(module), rec.id, ip);
  await logActivity(auth, rec.orgId, module, rec.id, text ? `Revision requested — ${text}` : "Revision requested");
  return { status: rec.status };
}

// ---- Controlled documents: OD's bespoke 3-step flow (cdSubmit → cdReview → cdPublish) ----

/** OD `cdSubmit` (12836): Draft / Revision Requested → Under Review, gated on the org's requireApprover setting. */
async function submitDocument(auth: AuthContext, recordId: string, ip: string | null) {
  const rec = await governedRecord(auth, "documents", recordId);
  if (rec.status !== "Draft" && rec.status !== "Revision Requested") {
    throw new ConflictError("Only a Draft or Revision Requested document can be submitted for review", "INVALID_STATE");
  }
  const settings = await getDocSettings(auth.orgId);
  const data = (rec.data ?? {}) as Record<string, unknown>;
  if (settings.requireApprover && !String(data.approver ?? "").trim()) {
    throw new BadRequestError("Assign an approver first", "DOC_APPROVER_REQUIRED");
  }
  const who = await actorName(auth);
  rec.status = "Under Review";
  rec.data = { ...data, submittedBy: who, submittedDate: nowIso() };
  await rec.save();
  await audit(auth, "approval.document.submitted", "ImplementationRecord", rec.id, ip);
  await logActivity(auth, rec.orgId, "documents", rec.id, "Submitted for review — status set to Under Review");
  return { record: null, status: rec.status };
}

export const CD_REVIEW_DECISIONS = ["Approve", "Request Revision", "Reject"] as const;
export interface DocumentReviewInput { decision: string; effectiveDate?: string | null; comments?: string | null }

/**
 * OD `cdReview`/`cdReviewSave` (12837–12849): the single reviewer decides
 * Approve (→ Approved, with an optional Approved Effective Date), Request
 * Revision (→ Revision Requested), or Reject (→ Rejected). The decision and
 * the review comments are stored on the record either way.
 */
export async function reviewDocument(auth: AuthContext, recordId: string, input: DocumentReviewInput, ip: string | null) {
  const rec = await governedRecord(auth, "documents", recordId);
  if (rec.status !== "Under Review") {
    throw new ConflictError("Only a document under review can receive a review decision", "NOT_UNDER_REVIEW");
  }
  const decision = input.decision;
  if (!CD_REVIEW_DECISIONS.includes(decision as (typeof CD_REVIEW_DECISIONS)[number])) {
    throw new BadRequestError("Review decision is required", "DECISION_REQUIRED");
  }
  const who = await actorName(auth);
  const now = nowIso();
  const comments = (input.comments ?? "").trim();
  const data: Record<string, unknown> = { ...(rec.data ?? {}), reviewDecision: decision, reviewComments: comments };
  let activityText: string;
  if (decision === "Approve") {
    rec.status = "Approved";
    data.approvedBy = who;
    data.approvedDate = now;
    if (input.effectiveDate) {
      const d = new Date(input.effectiveDate);
      if (!Number.isNaN(d.getTime())) data.effectiveDate = d.toISOString();
    }
    activityText = "Approved the document";
  } else if (decision === "Request Revision") {
    rec.status = "Revision Requested";
    activityText = `Requested revision — ${comments || "Returned to owner"}`;
  } else {
    rec.status = "Rejected";
    activityText = `Rejected the document — ${comments || "Rejected"}`;
  }
  rec.data = data;
  await rec.save();
  await audit(auth, "approval.document.reviewed", "ImplementationRecord", rec.id, ip);
  await logActivity(auth, rec.orgId, "documents", rec.id, activityText);
  return { status: rec.status, decision };
}

/**
 * OD `cdPublish` (12850–12856): a separate, explicit publish gated on the
 * Approved status. Supersedes the previously published version in the same
 * lineage, defaults the effective date, and derives the next review.
 */
export async function publishDocument(auth: AuthContext, recordId: string, ip: string | null) {
  const rec = await governedRecord(auth, "documents", recordId);
  if (rec.status !== "Approved") {
    throw new ConflictError("Only approved documents can be published", "NOT_APPROVED");
  }
  const who = await actorName(auth);
  await publishWithLineage(auth, rec as ImplementationRecord, who);
  rec.status = "Published";
  await rec.save();
  await audit(auth, "approval.document.published", "ImplementationRecord", rec.id, ip);
  const superseded = ((rec.data ?? {}) as Record<string, unknown>).supersedes as string | undefined;
  await logActivity(auth, rec.orgId, "documents", rec.id, superseded ? "Published — superseded prior version" : "Published the document");
  if (superseded) await logActivity(auth, rec.orgId, "documents", superseded, `Superseded — replaced by ${rec.code}`);
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
  await audit(auth, "approval.withdrawn", entityTypeOf(module), rec.id, ip);
  if (module === "policies") {
    await logActivity(auth, rec.orgId, module, rec.id, "Withdrew submission — returned to Draft by author");
  }
  return { status: rec.status };
}

/**
 * Governance check for records that are approved outside the multi-gate engine
 * (competence sign-off, which lives on its own model rather than
 * ImplementationRecord). It applies the two rules that actually protect the
 * decision: the approver must sit in a configured approval pool, and
 * self-approval is refused unless the org has enabled it.
 *
 * Throws ForbiddenError when the caller may not approve.
 */
export async function assertMayApprove(auth: AuthContext, authorName: string | null): Promise<void> {
  const who = await actorName(auth);
  const { selfApprovalAllowed } = await getSettings(auth);
  if (!selfApprovalAllowed && authorName && authorName === who) {
    throw new ForbiddenError("Self-approval is disabled for this organization");
  }
  const members = await listPoolMembers(auth);
  const me = members.find((m) => m.userId === auth.userId);
  if (!me || (!me.isMST && !me.isTM)) {
    throw new ForbiddenError("You are not in an approval pool. Add yourself under Approvals to sign off.");
  }
}
