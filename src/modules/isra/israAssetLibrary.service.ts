import {
  IsraPrimaryAssetLibrary, IsraSecondaryAssetLibrary, IsraPaGroup, IsraPaSubgroup, IsraSaGroup, IsraSaSubgroup,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * ISRA + SoA (F-2a) — Primary/Secondary Asset Library service (design doc
 * §2.3, Table Group A rows 8-9). Global platform catalogue, no `org_id`.
 * Mirrors OD `israPrimarySave`/`israSecondarySave` (`app.html:21684`/`21914`):
 * both require a Group + Sub-group pair where the sub-group actually belongs
 * to the chosen group, and Primary Assets auto-derive `category` from the
 * group name unless the caller overrides it.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const jsonObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

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

async function assertSubgroupInGroup(subgroupId: string, groupId: string, notFoundCode: string, notFoundMsg: string): Promise<void> {
  const sub = await IsraPaSubgroup.findByPk(subgroupId);
  if (!sub) throw new NotFoundError(notFoundMsg, notFoundCode);
  if (sub.groupId !== groupId) throw new BadRequestError("Sub-group does not belong to the selected group", "SUBGROUP_MISMATCH");
}
async function assertSaSubgroupInGroup(subgroupId: string, groupId: string): Promise<void> {
  const sub = await IsraSaSubgroup.findByPk(subgroupId);
  if (!sub) throw new NotFoundError("Secondary asset sub-group not found", "SA_SUBGROUP_NOT_FOUND");
  if (sub.groupId !== groupId) throw new BadRequestError("Sub-group does not belong to the selected group", "SUBGROUP_MISMATCH");
}

// ======================= Primary Asset Library ==============================
export async function listPrimaryAssets() {
  return (await IsraPrimaryAssetLibrary.findAll({ order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createPrimaryAsset(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "add Primary Asset library items");
  const name = str(input.name);
  if (!name) throw new BadRequestError("Asset name is required", "NAME_REQUIRED");
  const groupId = str(input.groupId);
  const subgroupId = str(input.subgroupId);
  if (!groupId || !subgroupId) throw new BadRequestError("Select a group and sub-group", "GROUP_REQUIRED");
  const group = await IsraPaGroup.findByPk(groupId);
  if (!group) throw new NotFoundError("Primary asset group not found", "PA_GROUP_NOT_FOUND");
  await assertSubgroupInGroup(subgroupId, groupId, "PA_SUBGROUP_NOT_FOUND", "Primary asset sub-group not found");
  const id = await nextId((await IsraPrimaryAssetLibrary.findAll({ attributes: ["id"] })).map((r) => r.id), "PAL-");
  const row = await IsraPrimaryAssetLibrary.create({
    id, name, category: str(input.category) ?? group.name, groupId, subgroupId,
    cia: jsonObj(input.cia), privacy: input.privacy === true, typicalSecondary: arr(input.typicalSecondary),
  });
  await logAudit(auth, "isra.primaryAsset.created", "IsraPrimaryAssetLibrary", row.id, ip);
  return row.get({ plain: true });
}

export async function updatePrimaryAsset(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "edit Primary Asset library items");
  const row = await IsraPrimaryAssetLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset not found", "PRIMARY_ASSET_NOT_FOUND");
  const nextGroupId = input.groupId !== undefined ? str(input.groupId) : row.groupId;
  const nextSubgroupId = input.subgroupId !== undefined ? str(input.subgroupId) : row.subgroupId;
  if (nextGroupId && nextSubgroupId && (input.groupId !== undefined || input.subgroupId !== undefined)) {
    await assertSubgroupInGroup(nextSubgroupId, nextGroupId, "PA_SUBGROUP_NOT_FOUND", "Primary asset sub-group not found");
  }
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Asset name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.groupId !== undefined) row.groupId = nextGroupId;
  if (input.subgroupId !== undefined) row.subgroupId = nextSubgroupId;
  if (input.category !== undefined) row.category = str(input.category);
  if (input.cia !== undefined) row.cia = jsonObj(input.cia);
  if (input.privacy !== undefined) row.privacy = input.privacy === true;
  if (input.typicalSecondary !== undefined) row.typicalSecondary = arr(input.typicalSecondary);
  await row.save();
  await logAudit(auth, "isra.primaryAsset.updated", "IsraPrimaryAssetLibrary", row.id, ip);
  return row.get({ plain: true });
}

export async function deletePrimaryAsset(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Primary Asset library items");
  const row = await IsraPrimaryAssetLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Primary asset not found", "PRIMARY_ASSET_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "isra.primaryAsset.deleted", "IsraPrimaryAssetLibrary", id, ip);
}

// ====================== Secondary Asset Library =============================
export async function listSecondaryAssets() {
  return (await IsraSecondaryAssetLibrary.findAll({ order: [["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}

export async function createSecondaryAsset(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "add Secondary Asset library items");
  const name = str(input.name);
  if (!name) throw new BadRequestError("Asset name is required", "NAME_REQUIRED");
  const groupId = str(input.groupId);
  const subgroupId = str(input.subgroupId);
  if (!groupId || !subgroupId) throw new BadRequestError("Select a group and sub-group", "GROUP_REQUIRED");
  const group = await IsraSaGroup.findByPk(groupId);
  if (!group) throw new NotFoundError("Secondary asset group not found", "SA_GROUP_NOT_FOUND");
  await assertSaSubgroupInGroup(subgroupId, groupId);
  const id = await nextId((await IsraSecondaryAssetLibrary.findAll({ attributes: ["id"] })).map((r) => r.id), "SAL-");
  const row = await IsraSecondaryAssetLibrary.create({ id, name, groupId, subgroupId, description: str(input.description) });
  await logAudit(auth, "isra.secondaryAsset.created", "IsraSecondaryAssetLibrary", row.id, ip);
  return row.get({ plain: true });
}

export async function updateSecondaryAsset(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  assertServiceOwner(auth, "edit Secondary Asset library items");
  const row = await IsraSecondaryAssetLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset not found", "SECONDARY_ASSET_NOT_FOUND");
  const nextGroupId = input.groupId !== undefined ? str(input.groupId) : row.groupId;
  const nextSubgroupId = input.subgroupId !== undefined ? str(input.subgroupId) : row.subgroupId;
  if (nextGroupId && nextSubgroupId && (input.groupId !== undefined || input.subgroupId !== undefined)) {
    await assertSaSubgroupInGroup(nextSubgroupId, nextGroupId);
  }
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Asset name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.groupId !== undefined) row.groupId = nextGroupId;
  if (input.subgroupId !== undefined) row.subgroupId = nextSubgroupId;
  if (input.description !== undefined) row.description = str(input.description);
  await row.save();
  await logAudit(auth, "isra.secondaryAsset.updated", "IsraSecondaryAssetLibrary", row.id, ip);
  return row.get({ plain: true });
}

export async function deleteSecondaryAsset(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth, "delete Secondary Asset library items");
  const row = await IsraSecondaryAssetLibrary.findByPk(id);
  if (!row) throw new NotFoundError("Secondary asset not found", "SECONDARY_ASSET_NOT_FOUND");
  await row.destroy();
  await logAudit(auth, "isra.secondaryAsset.deleted", "IsraSecondaryAssetLibrary", id, ip);
}
