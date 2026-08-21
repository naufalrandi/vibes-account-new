import { Op } from "sequelize";
import {
  IsraPaGroup, IsraPaSubgroup, IsraSaGroup, IsraSaSubgroup,
  IsraPrimaryAssetLibrary, IsraSecondaryAssetLibrary,
} from "../../db/models";
import { ISRA_SA_SUBGROUP_STATUS } from "../../db/models/israLibrary.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * ISRA + SoA (F-2a) — taxonomy service: PA Groups/Subgroups, SA Groups/
 * Subgroups (with the SA Subgroup approval workflow). These are Table
 * Group A (design doc §2.3) — global reference data, no `org_id`, seeded/
 * maintained by the Service Owner and read by every tenant.
 *
 * ID prefixes deliberately diverge from the design doc's §2.3 table in two
 * spots where that table's own prose disagrees with the live OD source
 * (`app.html`): the doc lists `isra_pa_subgroups` as `PASG-` (OD's actual
 * code uses `PSG-`) and lists `isra_sa_groups` as `SSG-` (OD's actual SA
 * *subgroup* prefix — `SAG-` is OD's real SA *group* prefix). Since `id` is
 * a free-form STRING PK with no format CHECK, this has no functional
 * consequence; the prefixes below are picked to be mutually unambiguous
 * (PAG-/PASG- for Primary Asset, SAG-/SSG- for Secondary Asset, matching
 * OD's real SA-group/SA-subgroup split) rather than to replay the doc typo.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Table Group A is platform-global reference data — only the Service Owner
 * may create/edit/delete it (mirrors `frameworkType.service.ts`'s
 * `assertServiceOwner`). Any authenticated org may read it — every tenant's
 * ISRA work depends on browsing this taxonomy. */
function assertServiceOwner(auth: AuthContext, action: string): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError(`Only the Service Owner can ${action}`);
}

async function logAudit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

async function nextId(existingIds: string[], prefix: string, pad = 3): Promise<string> {
  let max = 0;
  for (const id of existingIds) {
    const n = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(pad, "0")}`;
}

// ============================= PA Groups ==================================
export async function listPaGroups() {
  return (await IsraPaGroup.findAll({ order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createPaGroup(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "create Primary Asset groups");
  const name = str(input.name);
  if (!name) throw new BadRequestError("Group name is required", "NAME_REQUIRED");
  const id = await nextId((await IsraPaGroup.findAll({ attributes: ["id"] })).map((r) => r.id), "PAG-");
  const row = await IsraPaGroup.create({ id, name });
  await logAudit(auth, "isra.paGroup.created", "IsraPaGroup", row.id, ip);
  return row.get({ plain: true });
}

export async function updatePaGroup(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "update Primary Asset groups");
  const row = await IsraPaGroup.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset group not found", "PA_GROUP_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Group name is required", "NAME_REQUIRED");
    row.name = name;
  }
  await row.save();
  await logAudit(auth, "isra.paGroup.updated", "IsraPaGroup", row.id, ip);
  return row.get({ plain: true });
}

export async function deletePaGroup(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Primary Asset groups");
  const row = await IsraPaGroup.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset group not found", "PA_GROUP_NOT_FOUND");
  // No cascading delete (mirrors OD's own Lt-system safeguard note) — a group
  // with sub-groups must have them removed first, rather than silently wiping
  // the taxonomy tree the DB's own CASCADE would otherwise perform.
  const subCount = await IsraPaSubgroup.count({ where: { groupId: id } });
  if (subCount > 0) throw new ConflictError("Cannot delete a group that still has sub-groups", "PA_GROUP_IN_USE");
  await row.destroy();
  await logAudit(auth, "isra.paGroup.deleted", "IsraPaGroup", id, ip);
}

// ============================ PA Subgroups =================================
export async function listPaSubgroups(groupId?: string) {
  const where = groupId ? { groupId } : {};
  return (await IsraPaSubgroup.findAll({ where, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createPaSubgroup(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "create Primary Asset sub-groups");
  const groupId = str(input.groupId);
  const name = str(input.name);
  if (!groupId) throw new BadRequestError("Group is required", "GROUP_REQUIRED");
  if (!name) throw new BadRequestError("Sub-group name is required", "NAME_REQUIRED");
  const group = await IsraPaGroup.findByPk(groupId);
  if (!group) throw new NotFoundError("Primary asset group not found", "PA_GROUP_NOT_FOUND");
  const id = await nextId((await IsraPaSubgroup.findAll({ attributes: ["id"] })).map((r) => r.id), "PASG-");
  const row = await IsraPaSubgroup.create({ id, groupId, name, description: str(input.description), examples: arr(input.examples) });
  await logAudit(auth, "isra.paSubgroup.created", "IsraPaSubgroup", row.id, ip);
  return row.get({ plain: true });
}

export async function updatePaSubgroup(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "update Primary Asset sub-groups");
  const row = await IsraPaSubgroup.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset sub-group not found", "PA_SUBGROUP_NOT_FOUND");
  if (input.groupId !== undefined) {
    const groupId = str(input.groupId);
    if (!groupId) throw new BadRequestError("Group is required", "GROUP_REQUIRED");
    const group = await IsraPaGroup.findByPk(groupId);
    if (!group) throw new NotFoundError("Primary asset group not found", "PA_GROUP_NOT_FOUND");
    row.groupId = groupId;
  }
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Sub-group name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.description !== undefined) row.description = str(input.description);
  if (input.examples !== undefined) row.examples = arr(input.examples);
  await row.save();
  await logAudit(auth, "isra.paSubgroup.updated", "IsraPaSubgroup", row.id, ip);
  return row.get({ plain: true });
}

export async function deletePaSubgroup(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Primary Asset sub-groups");
  const row = await IsraPaSubgroup.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset sub-group not found", "PA_SUBGROUP_NOT_FOUND");
  const used = await IsraPrimaryAssetLibrary.count({ where: { subgroupId: id } });
  if (used > 0) throw new ConflictError("Cannot delete a sub-group referenced by primary asset library items", "PA_SUBGROUP_IN_USE");
  await row.destroy();
  await logAudit(auth, "isra.paSubgroup.deleted", "IsraPaSubgroup", id, ip);
}

// ============================= SA Groups ===================================
export async function listSaGroups() {
  return (await IsraSaGroup.findAll({ order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createSaGroup(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "create Secondary Asset groups");
  const name = str(input.name);
  if (!name) throw new BadRequestError("Group name is required", "NAME_REQUIRED");
  const id = await nextId((await IsraSaGroup.findAll({ attributes: ["id"] })).map((r) => r.id), "SAG-");
  const row = await IsraSaGroup.create({ id, name });
  await logAudit(auth, "isra.saGroup.created", "IsraSaGroup", row.id, ip);
  return row.get({ plain: true });
}

export async function updateSaGroup(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "update Secondary Asset groups");
  const row = await IsraSaGroup.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset group not found", "SA_GROUP_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Group name is required", "NAME_REQUIRED");
    row.name = name;
  }
  await row.save();
  await logAudit(auth, "isra.saGroup.updated", "IsraSaGroup", row.id, ip);
  return row.get({ plain: true });
}

export async function deleteSaGroup(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Secondary Asset groups");
  const row = await IsraSaGroup.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset group not found", "SA_GROUP_NOT_FOUND");
  const subCount = await IsraSaSubgroup.count({ where: { groupId: id } });
  if (subCount > 0) throw new ConflictError("Cannot delete a group that still has sub-groups", "SA_GROUP_IN_USE");
  await row.destroy();
  await logAudit(auth, "isra.saGroup.deleted", "IsraSaGroup", id, ip);
}

// ============================ SA Subgroups =================================
export async function listSaSubgroups(groupId?: string) {
  const where = groupId ? { groupId } : {};
  return (await IsraSaSubgroup.findAll({ where, order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createSaSubgroup(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "create Secondary Asset sub-groups");
  const groupId = str(input.groupId);
  const name = str(input.name);
  if (!groupId) throw new BadRequestError("Group is required", "GROUP_REQUIRED");
  if (!name) throw new BadRequestError("Sub-group name is required", "NAME_REQUIRED");
  const group = await IsraSaGroup.findByPk(groupId);
  if (!group) throw new NotFoundError("Secondary asset group not found", "SA_GROUP_NOT_FOUND");
  const id = await nextId((await IsraSaSubgroup.findAll({ attributes: ["id"] })).map((r) => r.id), "SSG-");
  // New sub-groups start life as `Draft` (the frozen model default) — they
  // never auto-approve. Baseline auto-load for a subgroup stays gated on an
  // explicit `Approved` transition via `setSaSubgroupStatus` below.
  const row = await IsraSaSubgroup.create({ id, groupId, name, description: str(input.description), examples: arr(input.examples) });
  await logAudit(auth, "isra.saSubgroup.created", "IsraSaSubgroup", row.id, ip);
  return row.get({ plain: true });
}

export async function updateSaSubgroup(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "update Secondary Asset sub-groups");
  const row = await IsraSaSubgroup.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset sub-group not found", "SA_SUBGROUP_NOT_FOUND");
  if (input.groupId !== undefined) {
    const groupId = str(input.groupId);
    if (!groupId) throw new BadRequestError("Group is required", "GROUP_REQUIRED");
    const group = await IsraSaGroup.findByPk(groupId);
    if (!group) throw new NotFoundError("Secondary asset group not found", "SA_GROUP_NOT_FOUND");
    row.groupId = groupId;
  }
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Sub-group name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.description !== undefined) row.description = str(input.description);
  if (input.examples !== undefined) row.examples = arr(input.examples);
  await row.save();
  await logAudit(auth, "isra.saSubgroup.updated", "IsraSaSubgroup", row.id, ip);
  return row.get({ plain: true });
}

export async function deleteSaSubgroup(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Secondary Asset sub-groups");
  const row = await IsraSaSubgroup.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset sub-group not found", "SA_SUBGROUP_NOT_FOUND");
  const used = await IsraSecondaryAssetLibrary.count({ where: { subgroupId: id } });
  if (used > 0) throw new ConflictError("Cannot delete a sub-group referenced by secondary asset library items", "SA_SUBGROUP_IN_USE");
  await row.destroy();
  await logAudit(auth, "isra.saSubgroup.deleted", "IsraSaSubgroup", id, ip);
}

/**
 * The approval-workflow transition (design doc §1.2/§2.3): `israSaSubApproved`
 * gates V2 baseline auto-load on a subgroup's `status === 'Approved'`. Live
 * OD (`isra2SaKmSetSubStatus`, `app.html:20028`) lets a reviewer reassign this
 * field freely via a `<select>` — it is not a strict forward-only Draft→Under
 * review→Approved→Retired graph at the data-model level, so this transition
 * accepts any value in `ISRA_SA_SUBGROUP_STATUS` rather than enforcing a
 * directed graph the live source doesn't actually enforce either.
 */
export async function setSaSubgroupStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  assertServiceOwner(auth, "change Secondary Asset sub-group approval status");
  if (!(ISRA_SA_SUBGROUP_STATUS as readonly string[]).includes(status)) {
    throw new BadRequestError(`Invalid status "${status}"`, "INVALID_STATUS");
  }
  const row = await IsraSaSubgroup.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset sub-group not found", "SA_SUBGROUP_NOT_FOUND");
  const prev = row.status;
  row.status = status;
  await row.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "isra.saSubgroup.status",
    entityType: "IsraSaSubgroup", entityId: row.id, sourceIp: ip, result: "Success",
    metadata: { prev, next: status },
  });
  return row.get({ plain: true });
}
