import {
  IsraLibraryOverride, IsraLibraryItem, IsraLibraryArchive, IsraLibraryAudit,
  IsraPrimaryAssetLibrary, IsraSecondaryAssetLibrary, IsraThreatLibrary, IsraVulnLibrary, User,
} from "../../db/models";
import { ISRA_LIB_TYPES, type IsraLibType, type IsraLibHistoryEntry } from "../../db/models/israLibraryOverride.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * ISRA + SoA (F-2a) — the "Lt" (library/tenant) override/item/archive/audit
 * system, design doc §2.4. Org-scoped provenance layer over the four global
 * library types (`primary`/`secondary`/`threat`/`vuln`, `ISRA_LIB_TYPES`).
 * Mirrors OD's `ISRA_LT_CFG`/`israLt*` cluster (`app.html:20347` onward):
 * an org can override a platform item's fields (never mutating the platform
 * row), create wholly own custom items, archive (suppress) a platform item
 * for itself without deleting it, and every mutation is audited.
 *
 * Threat/Vuln libraries (`IsraThreatLibrary`/`IsraVulnLibrary`) are F-2b's
 * territory — this file only ever *reads* those two models (as the platform
 * "master" side of the generic override system, which the frozen schema
 * requires to support all four `libType`s per §2.4), never builds threat/
 * vuln-specific service or route logic of its own.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));
const nowIso = () => new Date().toISOString();

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

function assertLibType(libType: string): asserts libType is IsraLibType {
  if (!(ISRA_LIB_TYPES as readonly string[]).includes(libType)) {
    throw new BadRequestError(`Invalid library type "${libType}"`, "INVALID_LIB_TYPE");
  }
}

/** The field set an override/tenant-item may carry per `libType`, and the
 * tenant-item id prefix — mirrors OD's `ISRA_LT_CFG` (`app.html:20347-20352`). */
const LT_CFG: Record<IsraLibType, { fields: readonly string[]; prefix: string }> = {
  primary: { fields: ["name", "description", "category", "groupId", "subgroupId", "privacy"], prefix: "TPA-" },
  secondary: { fields: ["name", "description", "groupId", "subgroupId"], prefix: "TSA-" },
  threat: { fields: ["name", "description", "category"], prefix: "TTHR-" },
  // `attrs` carries OD `israVulnForm`'s ten weighted attributes (1-5, "higher
  // = more severe"), which `israVulnWeight` averages into the vulnerability's
  // severity level. OD stores them on the custom vulnerability itself
  // (`israVulnSave`), so a tenant-authored vuln keeps its own weighting rather
  // than inheriting a platform item's. `customFields` is JSONB — no migration.
  vuln: { fields: ["name", "description", "category", "attrs"], prefix: "TVUL-" },
};
/** Fields carried directly on `IsraLibraryItem`'s own columns rather than
 * folded into its `customFields` JSONB envelope. */
const ITEM_COLUMN_FIELDS = new Set(["name", "description", "groupId", "subgroupId"]);

async function platformMaster(libType: IsraLibType, id: string): Promise<Record<string, unknown> | null> {
  const row = await (
    libType === "primary" ? IsraPrimaryAssetLibrary.findByPk(id) :
    libType === "secondary" ? IsraSecondaryAssetLibrary.findByPk(id) :
    libType === "threat" ? IsraThreatLibrary.findByPk(id) :
    IsraVulnLibrary.findByPk(id)
  );
  return row ? row.get({ plain: true }) : null;
}

async function platformMasterList(libType: IsraLibType): Promise<Record<string, unknown>[]> {
  const rows = await (
    libType === "primary" ? IsraPrimaryAssetLibrary.findAll() :
    libType === "secondary" ? IsraSecondaryAssetLibrary.findAll() :
    libType === "threat" ? IsraThreatLibrary.findAll() :
    IsraVulnLibrary.findAll()
  );
  return rows.map((r) => r.get({ plain: true }));
}

/** OD `israLibKey` (`app.html:20312`): a stable composite key spanning both
 * halves of the merged view, so the FE can address a row regardless of
 * whether it is a platform master or a tenant-owned item. */
function libKey(source: "platform" | "tenant", ownerOrgId: string | null, id: string): string {
  return `${source}:${ownerOrgId ?? "platform"}:${id}`;
}

async function logLtAudit(auth: AuthContext, orgId: string, action: string, libType: string, key: string, detail: Record<string, unknown> | null) {
  await IsraLibraryAudit.create({ orgId, actor: await actorName(auth), action, libType, key, detail });
}

export interface EffectiveLibraryRow {
  key: string;
  source: "platform" | "tenant";
  platformItemId: string | null;
  tenantItemId: string | null;
  name: string;
  groupId: string | null;
  subgroupId: string | null;
  description: string | null;
  category: string | null;
  customized: boolean;
  archived: boolean;
  overrideVersion: number;
  /**
   * R334 / OD `israLtPlatformUpdate` — the platform master's current version
   * and the version this override was taken against. When the master has
   * advanced the tenant is holding a stale customization and OD offers to
   * review it; nothing is ever merged automatically.
   */
  platformVersion: number;
  basePlatformVersion: number | null;
  platformUpdateAvailable: boolean;
  fields: Record<string, unknown>;
}

/** OD `israEffLib`: platform rows (with any org override merged in) plus the
 * org's own wholly-custom items, in one merged, archive-aware view. */
export async function listEffectiveLibrary(auth: AuthContext, libType: string, orgId?: string): Promise<EffectiveLibraryRow[]> {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const [masters, overrides, items, archive] = await Promise.all([
    platformMasterList(libType),
    IsraLibraryOverride.findAll({ where: { orgId: org, libType } }),
    IsraLibraryItem.findAll({ where: { orgId: org, libType } }),
    IsraLibraryArchive.findAll({ where: { orgId: org, libType } }),
  ]);
  const overrideByPlatformId = new Map(overrides.map((o) => [o.platformItemId, o]));
  const archivedKeys = new Set(archive.map((a) => a.itemKey));

  const platformRows: EffectiveLibraryRow[] = masters.map((m) => {
    const id = String(m.id);
    const key = libKey("platform", null, id);
    const ov = overrideByPlatformId.get(id);
    const platformVersion = Number(m.platformVersion ?? 1);
    const merged = { ...m, ...(ov?.fields ?? {}) };
    return {
      key, source: "platform", platformItemId: id, tenantItemId: null,
      name: String(merged.name ?? ""),
      groupId: (merged.groupId as string | undefined) ?? null,
      subgroupId: (merged.subgroupId as string | undefined) ?? null,
      description: (merged.description as string | undefined) ?? null,
      category: (merged.category as string | undefined) ?? null,
      customized: !!ov, archived: archivedKeys.has(key), overrideVersion: ov?.overrideVersion ?? 0,
      platformVersion,
      basePlatformVersion: ov?.basePlatformVersion ?? null,
      platformUpdateAvailable: !!ov && platformVersion > Number(ov.basePlatformVersion ?? 1),
      fields: merged,
    };
  });
  const tenantRows: EffectiveLibraryRow[] = items.map((ti) => {
    const key = libKey("tenant", org, ti.tenantItemId);
    return {
      key, source: "tenant", platformItemId: null, tenantItemId: ti.tenantItemId,
      name: ti.name, groupId: ti.groupId, subgroupId: ti.subgroupId, description: ti.description,
      category: (ti.customFields?.category as string | undefined) ?? null,
      customized: false, archived: archivedKeys.has(key), overrideVersion: 0,
      // A wholly-tenant item has no platform master behind it.
      platformVersion: 0, basePlatformVersion: null, platformUpdateAvailable: false,
      fields: { ...ti.customFields, name: ti.name, groupId: ti.groupId, subgroupId: ti.subgroupId, description: ti.description },
    };
  });
  return [...platformRows, ...tenantRows];
}

async function effectiveRecordByKey(auth: AuthContext, libType: IsraLibType, key: string, org: string): Promise<EffectiveLibraryRow | null> {
  const rows = await listEffectiveLibrary(auth, libType, org);
  return rows.find((r) => r.key === key) ?? null;
}

export async function listLibraryOverrides(auth: AuthContext, libType: string, orgId?: string) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  return (await IsraLibraryOverride.findAll({ where: { orgId: org, libType } })).map((r) => r.get({ plain: true }));
}

/** OD `israLtSaveOverride` (`app.html:20372`): edit-Platform-item -> create/
 * update a tenant override, never mutating the platform master. Only the
 * fields that actually differ from the master are stored in the diff, and
 * each save unshifts the prior `fields` snapshot into `history`. */
export async function saveLibraryOverride(
  auth: AuthContext, libType: string, platformItemId: string, fields: Record<string, unknown>, orgId: string | undefined, _ip: string | null,
): Promise<Record<string, unknown>> {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const master = await platformMaster(libType, platformItemId);
  if (!master) throw new NotFoundError("Platform library item not found", "MASTER_NOT_FOUND");
  const allowed = LT_CFG[libType].fields;
  const changed: Record<string, unknown> = {};
  for (const f of allowed) {
    if (fields[f] === undefined) continue;
    const mv = master[f] == null ? "" : String(master[f]);
    const nv = fields[f] == null ? "" : String(fields[f]);
    if (mv !== nv) changed[f] = fields[f];
  }
  const who = await actorName(auth);
  let ov = await IsraLibraryOverride.findOne({ where: { orgId: org, libType, platformItemId } });
  if (!ov) {
    // OD `israLtSaveOverride` (`core.js:15994`) stamps the master's
    // `platformVersion` (defaulting to 1) as the base the tenant customized
    // against — that is what `israLtPlatformUpdate` later compares to detect a
    // stale override. Storing null here made the comparison undefined.
    // The four platform library tables carry no version column yet, so this
    // resolves to 1 until one is added.
    const basePlatformVersion = Number(master.platformVersion ?? 1);
    ov = await IsraLibraryOverride.create({ orgId: org, libType, platformItemId, fields: changed, overrideVersion: 1, basePlatformVersion, history: [] });
  } else {
    const snapshot: IsraLibHistoryEntry = { ts: nowIso(), ver: ov.overrideVersion, by: who, fields: ov.fields };
    ov.history = [snapshot, ...ov.history];
    ov.fields = changed;
    ov.overrideVersion += 1;
    await ov.save();
  }
  await logLtAudit(auth, org, ov.overrideVersion === 1 ? "customize" : "edit-override", libType, libKey("platform", null, platformItemId), {
    version: ov.overrideVersion, fields: Object.keys(changed),
  });
  return ov.get({ plain: true });
}

/** OD `israLtRestore`: drop the tenant override — the platform default
 * reappears. Never touches committed snapshots elsewhere in the system. */
export async function restoreLibraryOverride(auth: AuthContext, libType: string, platformItemId: string, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const ov = await IsraLibraryOverride.findOne({ where: { orgId: org, libType, platformItemId } });
  if (!ov) throw new NotFoundError("No customization exists for this item", "OVERRIDE_NOT_FOUND");
  await ov.destroy();
  await logLtAudit(auth, org, "restore-default", libType, libKey("platform", null, platformItemId), null);
  return { restored: true };
}

function customFieldsFrom(libType: IsraLibType, input: Record<string, unknown>, base: Record<string, unknown> = {}): Record<string, unknown> {
  const out = { ...base };
  for (const f of LT_CFG[libType].fields) {
    if (ITEM_COLUMN_FIELDS.has(f)) continue;
    if (input[f] !== undefined) out[f] = input[f];
  }
  return out;
}

async function nextTenantItemId(org: string, libType: IsraLibType): Promise<string> {
  const prefix = LT_CFG[libType].prefix;
  const rows = await IsraLibraryItem.findAll({ where: { orgId: org, libType }, attributes: ["tenantItemId"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.tenantItemId.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Plain create of an org's own wholly-custom library row — the CRUD "create"
 * half of `IsraLibraryItem`, complementing OD's copy-only `israLtCustomCopy`. */
export async function createLibraryItem(auth: AuthContext, libType: string, input: Record<string, unknown>, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const name = str(input.name);
  if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const tenantItemId = await nextTenantItemId(org, libType);
  const row = await IsraLibraryItem.create({
    orgId: org, libType, tenantItemId, name, groupId: str(input.groupId), subgroupId: str(input.subgroupId),
    description: str(input.description), customFields: customFieldsFrom(libType, input),
  });
  await logLtAudit(auth, org, "create-tenant-item", libType, libKey("tenant", org, tenantItemId), { name });
  return row.get({ plain: true });
}

/** OD `israLtCustomCopy` (`app.html:20392`): clone an existing effective
 * record (platform or tenant) into a NEW, wholly independent tenant item —
 * no mapping copy, no link back for resolution. */
export async function copyLibraryItem(auth: AuthContext, libType: string, sourceKey: string, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const source = await effectiveRecordByKey(auth, libType, sourceKey, org);
  if (!source) throw new NotFoundError("Source item not found", "SOURCE_NOT_FOUND");
  const tenantItemId = await nextTenantItemId(org, libType);
  const customFields = { ...source.fields };
  delete customFields.name; delete customFields.description; delete customFields.groupId; delete customFields.subgroupId; delete customFields.id;
  const row = await IsraLibraryItem.create({
    orgId: org, libType, tenantItemId, name: `${source.name} (Custom Copy)`,
    groupId: source.groupId, subgroupId: source.subgroupId, description: source.description, customFields,
  });
  await logLtAudit(auth, org, "custom-copy", libType, libKey("tenant", org, tenantItemId), { from: sourceKey });
  return row.get({ plain: true });
}

/** OD `israLtUpdateTenantItem`. The frozen schema does not carry a per-field
 * `history` column on `isra_library_items` (unlike overrides, which do) — the
 * edit is still fully traceable via `isra_library_audit`'s append-only trail. */
export async function updateLibraryItem(auth: AuthContext, libType: string, tenantItemId: string, input: Record<string, unknown>, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const row = await IsraLibraryItem.findOne({ where: { orgId: org, libType, tenantItemId } });
  if (!row) throw new NotFoundError("Custom library item not found", "ITEM_NOT_FOUND");
  if (input.name !== undefined) {
    const name = str(input.name);
    if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    row.name = name;
  }
  if (input.description !== undefined) row.description = str(input.description);
  if (input.groupId !== undefined) row.groupId = str(input.groupId);
  if (input.subgroupId !== undefined) row.subgroupId = str(input.subgroupId);
  row.customFields = customFieldsFrom(libType, input, row.customFields);
  await row.save();
  await logLtAudit(auth, org, "edit-tenant-item", libType, libKey("tenant", org, tenantItemId), { fields: Object.keys(input) });
  return row.get({ plain: true });
}

// ============================== Archive =====================================
export async function listArchivedItems(auth: AuthContext, libType: string, orgId?: string) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  return (await IsraLibraryArchive.findAll({ where: { orgId: org, libType } })).map((r) => r.get({ plain: true }));
}

/** OD `israLtArchive`: suppress an item (platform or tenant) for this org —
 * excluded from new selection, still reference-resolvable. Never a delete. */
export async function archiveLibraryItem(auth: AuthContext, libType: string, itemKey: string, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const exists = await IsraLibraryArchive.findOne({ where: { orgId: org, libType, itemKey } });
  if (exists) throw new ConflictError("Item is already archived", "ALREADY_ARCHIVED");
  const row = await IsraLibraryArchive.create({ orgId: org, libType, itemKey });
  await logLtAudit(auth, org, "archive", libType, itemKey, null);
  return row.get({ plain: true });
}

export async function unarchiveLibraryItem(auth: AuthContext, libType: string, itemKey: string, orgId: string | undefined, _ip: string | null) {
  assertLibType(libType);
  const org = await targetOrg(auth, orgId);
  const row = await IsraLibraryArchive.findOne({ where: { orgId: org, libType, itemKey } });
  if (!row) throw new NotFoundError("Item is not archived", "NOT_ARCHIVED");
  await row.destroy();
  await logLtAudit(auth, org, "unarchive", libType, itemKey, null);
  return { unarchived: true };
}

// =============================== Audit ======================================
export async function listLibraryAudit(auth: AuthContext, orgId?: string, libType?: string) {
  const org = await targetOrg(auth, orgId);
  const where: Record<string, unknown> = { orgId: org };
  if (libType !== undefined) {
    assertLibType(libType);
    where.libType = libType;
  }
  return (await IsraLibraryAudit.findAll({ where, order: [["ts", "DESC"]] })).map((r) => r.get({ plain: true }));
}
