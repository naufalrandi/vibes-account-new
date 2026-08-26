import { Op } from "sequelize";
import { OrgUnit, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";

/** Fixed 5-tier depth: root = A (depth 0) .. E (depth 4+, clamped). */
export const TIER_ORDER = ["A", "B", "C", "D", "E"] as const;
export type Tier = (typeof TIER_ORDER)[number];

/** Fixed L1-L12 employment-level structure, mirroring the OD mockup's `EMP_TIERS`. */
export const EMP_TIERS = [
  { tier: "A", label: "Executive", levels: [["L1", "Chief Executive"], ["L2", "Executive Officer"]] },
  { tier: "B", label: "Directorate", levels: [["L3", "Senior Director"], ["L4", "Director"]] },
  { tier: "C", label: "Division", levels: [["L5", "Senior Division Manager"], ["L6", "Division Manager"]] },
  { tier: "D", label: "Department", levels: [["L7", "Senior Department Manager"], ["L8", "Department Manager"]] },
  { tier: "E", label: "Unit", levels: [["L9", "Unit Manager"], ["L10", "Unit Supervisor"], ["L11", "Officer/Associate"], ["L12", "Apprentice/Intern"]] },
] as const;

export const EMP_LEVEL_CODES: Set<string> = new Set(EMP_TIERS.flatMap((t) => t.levels.map(([code]) => code as string)));

/** Appointable levels per tier (A-D: senior+base; E: L9/L10 only). */
export function tierAppointLevels(tier: string): string[] {
  return { A: ["L1", "L2"], B: ["L3", "L4"], C: ["L5", "L6"], D: ["L7", "L8"], E: ["L9", "L10"] }[tier] ?? [];
}

function tierAt(depth: number): Tier {
  return TIER_ORDER[Math.min(Math.max(depth, 0), TIER_ORDER.length - 1)];
}

export interface OrgUnitView {
  id: string;
  name: string;
  parentId: string | null;
  tier: string;
  appt: Record<string, string>;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgUnitInput {
  name?: string;
  parentId?: string | null;
  appt?: Record<string, string | null>;
}

export interface ReparentImpact {
  unitId: string;
  unitName: string;
  oldTier: string;
  newTier: string;
}

export interface ReparentAffectedPerson {
  userId: string;
  userName: string;
  unitId: string;
  unitName: string;
  oldTier: string;
  newTier: string;
  oldLevel: string;
  newLevel: string;
}

export interface ReparentPreview {
  unitId: string;
  newParentId: string | null;
  impacts: ReparentImpact[];
  affected: ReparentAffectedPerson[];
}

/** Loads every org unit in the org, builds parent/children lookups for tree ops. */
async function loadTree(orgId: string): Promise<{
  byId: Map<string, OrgUnit>;
  childrenOf: Map<string | null, OrgUnit[]>;
}> {
  const rows = await OrgUnit.findAll({ where: { orgId } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string | null, OrgUnit[]>();
  for (const r of rows) {
    const key = r.parentId;
    const list = childrenOf.get(key) ?? [];
    list.push(r);
    childrenOf.set(key, list);
  }
  return { byId, childrenOf };
}

function depthOf(id: string | null, byId: Map<string, OrgUnit>): number {
  let depth = 0;
  let cur = id ? byId.get(id) : undefined;
  let guard = 0;
  while (cur?.parentId && guard++ < TIER_ORDER.length + 5) {
    depth++;
    cur = byId.get(cur.parentId);
  }
  return depth;
}

function isDescendant(candidateId: string, ofId: string, childrenOf: Map<string | null, OrgUnit[]>): boolean {
  const stack = [...(childrenOf.get(ofId) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === candidateId) return true;
    stack.push(...(childrenOf.get(node.id) ?? []));
  }
  return false;
}

function subtreeIds(rootId: string, childrenOf: Map<string | null, OrgUnit[]>): string[] {
  const out: string[] = [rootId];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node.id);
    stack.push(...(childrenOf.get(node.id) ?? []));
  }
  return out;
}

function view(u: OrgUnit, memberCount = 0): OrgUnitView {
  return {
    id: u.id, name: u.name, parentId: u.parentId, tier: u.tier, appt: u.appt ?? {},
    memberCount, createdAt: u.createdAt, updatedAt: u.updatedAt,
  };
}

export async function listOrgUnits(auth: AuthContext): Promise<OrgUnitView[]> {
  const rows = await OrgUnit.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "ASC"]] });
  const counts = await User.findAll({ where: { orgId: auth.orgId }, attributes: ["orgUnitId"] });
  const countByUnit = new Map<string, number>();
  for (const u of counts) {
    if (!u.orgUnitId) continue;
    countByUnit.set(u.orgUnitId, (countByUnit.get(u.orgUnitId) ?? 0) + 1);
  }
  return rows.map((r) => view(r, countByUnit.get(r.id) ?? 0));
}

async function requireOrgUnit(auth: AuthContext, id: string): Promise<OrgUnit> {
  const u = await OrgUnit.findOne({ where: { id, orgId: auth.orgId } });
  if (!u) throw new NotFoundError("Org unit does not exist", "ORG_UNIT_NOT_FOUND");
  return u;
}

/** Validates `appt` entries: level must be appointable for `tier`, user must exist,
 * belong to this org, and already be assigned to this org unit. */
async function assertAppt(orgId: string, unitId: string, tier: string, appt: Record<string, string | null>): Promise<Record<string, string>> {
  const allowed = new Set(tierAppointLevels(tier));
  const out: Record<string, string> = {};
  for (const [level, userId] of Object.entries(appt)) {
    if (!userId) continue;
    if (!allowed.has(level)) throw new BadRequestError(`Level "${level}" is not appointable for tier ${tier}`, "INVALID_APPT_LEVEL");
    const person = await User.findOne({ where: { id: userId, orgId } });
    if (!person) throw new BadRequestError("Appointed user does not exist", "APPT_USER_NOT_FOUND");
    if (person.orgUnitId !== unitId) throw new BadRequestError("Appointed user is not a member of this org unit", "APPT_USER_NOT_MEMBER");
    out[level] = userId;
  }
  return out;
}

export async function createOrgUnit(auth: AuthContext, input: OrgUnitInput, ip: string | null): Promise<OrgUnitView> {
  if (!input.name || !input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const { byId } = await loadTree(auth.orgId);

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = byId.get(input.parentId);
    if (!parent) throw new BadRequestError("Parent org unit does not belong to this organization", "INVALID_PARENT");
    if (parent.tier === "E") throw new BadRequestError("Cannot add a sub-unit under a tier E (Unit) node — max depth reached", "MAX_DEPTH_EXCEEDED");
    parentId = parent.id;
  }
  const tier = tierAt(parentId ? depthOf(parentId, byId) + 1 : 0);

  const created = await OrgUnit.create({ orgId: auth.orgId, name: input.name.trim(), parentId, tier, appt: {} });
  if (input.appt) {
    created.appt = await assertAppt(auth.orgId, created.id, tier, input.appt);
    await created.save();
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "orgUnit.created", entityType: "OrgUnit", entityId: created.id, sourceIp: ip, result: "Success" });
  return view(created);
}

export async function updateOrgUnit(auth: AuthContext, id: string, input: OrgUnitInput, ip: string | null): Promise<OrgUnitView> {
  const unit = await requireOrgUnit(auth, id);
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    unit.name = input.name.trim();
  }
  if (input.appt !== undefined) unit.appt = await assertAppt(auth.orgId, unit.id, unit.tier, input.appt);
  await unit.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "orgUnit.updated", entityType: "OrgUnit", entityId: unit.id, sourceIp: ip, result: "Success" });
  return view(unit);
}

export async function deleteOrgUnit(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const unit = await requireOrgUnit(auth, id);
  const { childrenOf } = await loadTree(auth.orgId);
  if ((childrenOf.get(unit.id) ?? []).length) {
    throw new ConflictError("Org unit has sub-units — move or delete them first", "HAS_CHILDREN");
  }
  await User.update({ orgUnitId: null }, { where: { orgUnitId: unit.id, orgId: auth.orgId } });
  await unit.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "orgUnit.deleted", entityType: "OrgUnit", entityId: unit.id, sourceIp: ip, result: "Success" });
}

export async function listOrgUnitMembers(auth: AuthContext, id: string): Promise<User[]> {
  await requireOrgUnit(auth, id);
  return User.findAll({ where: { orgId: auth.orgId, orgUnitId: id } });
}

/** Builds the impact/affected preview for moving `id` under `newParentId`, without persisting. */
async function buildReparentPreview(
  auth: AuthContext,
  id: string,
  newParentId: string | null,
): Promise<{ preview: ReparentPreview; byId: Map<string, OrgUnit>; childrenOf: Map<string | null, OrgUnit[]> }> {
  const unit = await requireOrgUnit(auth, id);
  const { byId, childrenOf } = await loadTree(auth.orgId);

  if (newParentId) {
    if (newParentId === id) throw new BadRequestError("Cannot move a unit under itself", "INVALID_PARENT");
    const parent = byId.get(newParentId);
    if (!parent) throw new BadRequestError("New parent org unit does not belong to this organization", "INVALID_PARENT");
    if (isDescendant(newParentId, id, childrenOf)) throw new BadRequestError("Cannot move a unit under its own descendant", "CYCLE_DETECTED");
  }

  const oldDepth = depthOf(id, byId);
  const newDepth = newParentId ? depthOf(newParentId, byId) + 1 : 0;
  if (newDepth > TIER_ORDER.length - 1) {
    throw new BadRequestError("Move would push the subtree deeper than tier E", "MAX_DEPTH_EXCEEDED");
  }
  const dd = newDepth - oldDepth;

  const impacts: ReparentImpact[] = [];
  const affected: ReparentAffectedPerson[] = [];
  const members = dd !== 0 ? await User.findAll({ where: { orgId: auth.orgId, orgUnitId: { [Op.in]: subtreeIds(id, childrenOf) } } }) : [];
  const membersByUnit = new Map<string, User[]>();
  for (const m of members) {
    if (!m.orgUnitId) continue;
    const list = membersByUnit.get(m.orgUnitId) ?? [];
    list.push(m);
    membersByUnit.set(m.orgUnitId, list);
  }

  for (const su of subtreeIds(id, childrenOf).map((sid) => byId.get(sid)!)) {
    const suDepth = depthOf(su.id, byId);
    const oldTier = tierAt(suDepth);
    const newTier = tierAt(suDepth + dd);
    if (newTier === oldTier) continue;
    impacts.push({ unitId: su.id, unitName: su.name, oldTier, newTier });
    const oldLvls = tierAppointLevels(oldTier);
    const newLvls = tierAppointLevels(newTier);
    for (const [oldLevel, userId] of Object.entries(su.appt ?? {})) {
      const i = oldLvls.indexOf(oldLevel);
      const newLevel = i >= 0 ? (newLvls[i] ?? newLvls[newLvls.length - 1]) : oldLevel;
      if (!newLevel) continue;
      const person = (membersByUnit.get(su.id) ?? []).find((m) => m.id === userId);
      if (!person) continue;
      affected.push({ userId: person.id, userName: person.fullName, unitId: su.id, unitName: su.name, oldTier, newTier, oldLevel, newLevel });
    }
  }

  return { preview: { unitId: id, newParentId, impacts, affected }, byId, childrenOf };
}

export async function previewReparentOrgUnit(auth: AuthContext, id: string, newParentId: string | null): Promise<ReparentPreview> {
  const { preview } = await buildReparentPreview(auth, id, newParentId);
  return preview;
}

export async function reparentOrgUnit(auth: AuthContext, id: string, newParentId: string | null, ip: string | null): Promise<{ unit: OrgUnitView; preview: ReparentPreview }> {
  const { preview, byId, childrenOf } = await buildReparentPreview(auth, id, newParentId);
  const unit = byId.get(id)!;

  const newTierById = new Map(preview.impacts.map((i) => [i.unitId, i.newTier]));

  await OrgUnit.sequelize!.transaction(async (tx) => {
    unit.parentId = newParentId;
    await unit.save({ transaction: tx });

    for (const su of subtreeIds(id, childrenOf).map((sid) => byId.get(sid)!)) {
      const newTier = newTierById.get(su.id);
      if (!newTier) continue; // unchanged tier — appt/level mapping stays as-is
      const oldLvls = tierAppointLevels(su.tier);
      const newLvls = tierAppointLevels(newTier);
      const remapped: Record<string, string> = {};
      for (const [oldLevel, userId] of Object.entries(su.appt ?? {})) {
        const i = oldLvls.indexOf(oldLevel);
        const newLevel = i >= 0 ? (newLvls[i] ?? newLvls[newLvls.length - 1]) : oldLevel;
        if (newLevel) remapped[newLevel] = userId;
      }
      su.tier = newTier;
      su.appt = remapped;
      await su.save({ transaction: tx });
    }

    for (const a of preview.affected) {
      await User.update({ empLevel: a.newLevel }, { where: { id: a.userId, orgId: auth.orgId }, transaction: tx });
    }
  });

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "orgUnit.reparented", entityType: "OrgUnit", entityId: id, sourceIp: ip, result: "Success" });
  return { unit: view(byId.get(id)!), preview };
}
