import { Op, Model, type ModelStatic } from "sequelize";
import { IpParty, IpRequirement, ImplementationRecord, User } from "../../db/models";
import { IP_CATEGORIES, IP_REQ_TYPES, IP_REQ_STATUS } from "../../db/models/interestedParty.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { createRecord } from "../implementation/implementation.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

const nowIso = () => new Date().toISOString();
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}
async function targetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}
async function orgWhere(auth: AuthContext): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}
async function nextCode(model: ModelStatic<Model>, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } } });
  let max = 0;
  for (const r of rows) { const n = Number.parseInt(String(r.get("code")).slice(prefix.length + 1), 10); if (Number.isFinite(n) && n > max) max = n; }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
async function audit(auth: AuthContext, action: string, entityType: string, id: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId: id, sourceIp: ip, result: "Success" });
}
const pushAct = (list: IpParty["activity"], user: string, action: string, summary?: string) => [{ ts: nowIso(), user, action, ...(summary ? { summary } : {}) }, ...list];

/** Party display status is derived from its requirements (ISO-parity rule). */
function derivedStatus(reqs: IpRequirement[]): string {
  if (reqs.length === 0) return "Under Review";
  if (reqs.every((r) => r.status === "Archived")) return "Archived";
  return "Active";
}

// --- Parties ------------------------------------------------------------
export async function listParties(auth: AuthContext) {
  const where = await orgWhere(auth);
  const parties = await IpParty.findAll({ where, order: [["createdAt", "DESC"]] });
  const reqs = await IpRequirement.findAll({ where });
  const byParty = new Map<string, IpRequirement[]>();
  for (const r of reqs) { const k = r.partyId; byParty.set(k, [...(byParty.get(k) ?? []), r]); }
  return parties.map((p) => {
    const rs = byParty.get(p.id) ?? [];
    return { ...p.get({ plain: true }), derivedStatus: derivedStatus(rs), reqCount: rs.filter((r) => r.status !== "Archived").length, linkedCoCount: rs.filter((r) => r.linkedObligations.length > 0).length };
  });
}
export async function getParty(auth: AuthContext, id: string) {
  const p = await IpParty.findByPk(id);
  if (!p) throw new NotFoundError("Party not found", "PARTY_NOT_FOUND");
  await targetOrg(auth, p.orgId);
  const rs = await IpRequirement.findAll({ where: { partyId: p.id }, order: [["createdAt", "DESC"]] });
  return { ...p.get({ plain: true }), derivedStatus: derivedStatus(rs), requirements: rs.map((r) => r.get({ plain: true })) };
}
export async function createParty(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const name = str(input.name);
  const category = str(input.category);
  if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  if (!category || !IP_CATEGORIES.includes(category as never)) throw new BadRequestError("A valid category is required", "CATEGORY_REQUIRED");
  const who = await actorName(auth);
  const row = await IpParty.create({
    orgId: org, code: await nextCode(IpParty, "IP"), name, category, description: str(input.description),
    frameworks: arr(input.frameworks), status: "Active", createdBy: who, lastUpdatedBy: who,
    activity: [{ ts: nowIso(), user: who, action: "created", summary: "Interested party created" }],
  });
  await audit(auth, "ip.party.created", "IpParty", row.id, ip);
  return row.get({ plain: true });
}
async function requireParty(auth: AuthContext, id: string): Promise<IpParty> {
  const p = await IpParty.findByPk(id);
  if (!p) throw new NotFoundError("Party not found", "PARTY_NOT_FOUND");
  await targetOrg(auth, p.orgId);
  return p;
}
export async function updateParty(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const p = await requireParty(auth, id);
  if (input.name !== undefined) p.name = str(input.name) ?? p.name;
  if (input.category !== undefined) { const c = str(input.category); if (c && IP_CATEGORIES.includes(c as never)) p.category = c; }
  if (input.description !== undefined) p.description = str(input.description);
  if (input.frameworks !== undefined) p.frameworks = arr(input.frameworks);
  const who = await actorName(auth);
  p.lastUpdatedBy = who; p.activity = pushAct(p.activity, who, "updated", "Interested party edited");
  await p.save();
  await audit(auth, "ip.party.updated", "IpParty", p.id, ip);
  return p.get({ plain: true });
}
export async function archiveParty(auth: AuthContext, id: string, ip: string | null) {
  const p = await requireParty(auth, id);
  const rs = await IpRequirement.findAll({ where: { partyId: p.id } });
  const unresolved = rs.filter((r) => r.status !== "Dismissed" && r.status !== "Archived");
  if (unresolved.length) throw new ConflictError("Resolve or archive the party's requirements first", "REQS_UNRESOLVED");
  const who = await actorName(auth);
  p.status = "Archived"; p.activity = pushAct(p.activity, who, "archived", "Interested party archived");
  await p.save();
  await audit(auth, "ip.party.archived", "IpParty", p.id, ip);
  return p.get({ plain: true });
}

// --- Requirements -------------------------------------------------------
export async function listRequirements(auth: AuthContext, partyId?: string) {
  const where = await orgWhere(auth);
  if (partyId) Object.assign(where, { partyId });
  const rs = await IpRequirement.findAll({ where, order: [["createdAt", "DESC"]] });
  const risks = await ImplementationRecord.findAll({ where: { ...(await orgWhere(auth)), module: "risks" }, attributes: ["data"] });
  const riskCount = (code: string) => risks.filter((x) => (x.data as { sourceReqId?: string })?.sourceReqId === code).length;
  return rs.map((r) => ({ ...r.get({ plain: true }), linkedRiskCount: riskCount(r.code) }));
}
async function requireReq(auth: AuthContext, id: string): Promise<IpRequirement> {
  const r = await IpRequirement.findByPk(id);
  if (!r) throw new NotFoundError("Requirement not found", "REQ_NOT_FOUND");
  await targetOrg(auth, r.orgId);
  return r;
}
export async function createRequirement(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const org = await targetOrg(auth);
  const partyId = str(input.partyId);
  const topic = str(input.topic);
  if (!partyId) throw new BadRequestError("Party is required", "PARTY_REQUIRED");
  if (!topic) throw new BadRequestError("Topic is required", "TOPIC_REQUIRED");
  const party = await IpParty.findOne({ where: { id: partyId, orgId: org } });
  if (!party) throw new NotFoundError("Party not found", "PARTY_NOT_FOUND");
  const type = str(input.type) ?? "Requirement";
  if (!IP_REQ_TYPES.includes(type as never)) throw new BadRequestError(`Invalid requirement type "${type}"`, "INVALID_TYPE");
  const linked = arr(input.linkedObligations);
  if (input.relatedCO === true && linked.length === 0) throw new BadRequestError("Select at least one obligation when related to a compliance obligation", "OBLIGATION_REQUIRED");
  const who = await actorName(auth);
  const row = await IpRequirement.create({
    orgId: org, code: await nextCode(IpRequirement, "IP-REQ"), partyId, topic, description: str(input.description), type,
    frameworks: arr(input.frameworks), relatedCO: linked.length > 0, linkedObligations: linked, status: "Open",
    createdBy: who, lastUpdatedBy: who, activity: [{ ts: nowIso(), user: who, action: "created", summary: "Requirement added" }],
  });
  await audit(auth, "ip.requirement.created", "IpRequirement", row.id, ip);
  return { ...row.get({ plain: true }), linkedRiskCount: 0 };
}
export async function updateRequirement(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const r = await requireReq(auth, id);
  if (input.topic !== undefined) r.topic = str(input.topic) ?? r.topic;
  if (input.description !== undefined) r.description = str(input.description);
  if (input.type !== undefined) { const t = str(input.type); if (t && IP_REQ_TYPES.includes(t as never)) r.type = t; }
  if (input.frameworks !== undefined) r.frameworks = arr(input.frameworks);
  const who = await actorName(auth);
  r.lastUpdatedBy = who; r.activity = pushAct(r.activity, who, "updated", "Requirement edited");
  await r.save();
  await audit(auth, "ip.requirement.updated", "IpRequirement", r.id, ip);
  return r.get({ plain: true });
}

const JUSTIFY: Record<string, string> = { "On Hold": "holdJustification", Dismissed: "dismissJustification" };
export async function setRequirementStatus(auth: AuthContext, id: string, status: string, justification: string | null, ip: string | null) {
  if (!IP_REQ_STATUS.includes(status as never)) throw new BadRequestError(`Invalid status "${status}"`, "INVALID_STATUS");
  const r = await requireReq(auth, id);
  const who = await actorName(auth);
  if (JUSTIFY[status]) {
    if (!justification || !justification.trim()) throw new BadRequestError(`A justification is required to ${status === "Dismissed" ? "dismiss" : "put on hold"} the requirement`, "JUSTIFICATION_REQUIRED");
    (r as unknown as Record<string, unknown>)[JUSTIFY[status]] = justification.trim();
    r.decidedBy = who; r.decidedAt = nowIso();
  }
  if (status === "Addressed") { r.decidedBy = who; r.decidedAt = nowIso(); }
  r.status = status;
  r.lastUpdatedBy = who; r.activity = pushAct(r.activity, who, "status", `Status → ${status}`);
  await r.save();
  await audit(auth, "ip.requirement.status", "IpRequirement", r.id, ip);
  return r.get({ plain: true });
}

/** Raise a risk from an Addressed requirement into the risks register. */
export async function raiseRisk(auth: AuthContext, id: string, description: string | null, ip: string | null) {
  const r = await requireReq(auth, id);
  if (r.status !== "Addressed") throw new ConflictError("Mark the requirement as Addressed before raising a risk", "NOT_ADDRESSED");
  const who = await actorName(auth);
  const risk = await createRecord(auth, "risks", {
    title: r.topic,
    data: { category: "Quality Risks", source: "Interested Party", sourceReqId: r.code, issueCategory: r.type, description: description || r.description, frameworks: r.frameworks },
  }, r.orgId, ip);
  r.raisedAsRisk = true;
  r.lastUpdatedBy = who; r.activity = pushAct(r.activity, who, "raised-risk", `Linked risk ${risk.code}`);
  await r.save();
  await audit(auth, "ip.requirement.raisedRisk", "IpRequirement", r.id, ip);
  return { ...r.get({ plain: true }), linkedRisk: risk.code };
}

export async function linkObligations(auth: AuthContext, id: string, obligationCodes: string[], ip: string | null) {
  const r = await requireReq(auth, id);
  const codes = obligationCodes.map(String).filter(Boolean);
  r.linkedObligations = codes; r.relatedCO = codes.length > 0;
  const who = await actorName(auth);
  r.lastUpdatedBy = who; r.activity = pushAct(r.activity, who, "obligations", codes.length ? `Linked obligations: ${codes.join(", ")}` : "Unlinked all obligations");
  await r.save();
  await audit(auth, "ip.requirement.obligations", "IpRequirement", r.id, ip);
  return r.get({ plain: true });
}

export async function archiveRequirement(auth: AuthContext, id: string, justification: string | null, ip: string | null) {
  const r = await requireReq(auth, id);
  const who = await actorName(auth);
  // Direct archive of an Addressed requirement needs no open risks + a justification.
  if (r.status === "Addressed") {
    const risks = await ImplementationRecord.findAll({ where: { orgId: r.orgId, module: "risks" }, attributes: ["data", "status"] });
    const open = risks.filter((x) => (x.data as { sourceReqId?: string })?.sourceReqId === r.code && x.status !== "Archived");
    if (open.length) throw new ConflictError("Archive the related risks first", "RISKS_OPEN");
    if (!justification || !justification.trim()) throw new BadRequestError("A justification is required to archive an addressed requirement", "JUSTIFICATION_REQUIRED");
    r.archiveJustification = justification.trim();
  }
  r.status = "Archived"; r.archivedBy = who; r.archivedAt = nowIso();
  r.lastUpdatedBy = who; r.activity = pushAct(r.activity, who, "archived", "Requirement archived");
  await r.save();
  await audit(auth, "ip.requirement.archived", "IpRequirement", r.id, ip);
  return r.get({ plain: true });
}
