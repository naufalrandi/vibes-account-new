import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group B (migration 0062): org-level library customization
 * (the "Lt" system, design doc §2.4). Applies to exactly four `libType`s.
 * `platformItemId`/`itemKey` are soft references (design doc §2.10) — the
 * target table depends on `libType`, so no single hard FK can express it.
 */
export const ISRA_LIB_TYPES = ["primary", "secondary", "threat", "vuln"] as const;
export type IsraLibType = (typeof ISRA_LIB_TYPES)[number];

/** One revision snapshot in `IsraLibraryOverride.history`. Field names match
 * OD's `israLtSaveOverride` snapshot (`core.js:15995`) so the design's history
 * modal (`core.js:16225`, which renders `r.ver`/`r.ts`/`r.by`) reads it as-is. */
export interface IsraLibHistoryEntry { ts: string; ver: number; by: string; fields: Record<string, unknown> }

/** `israTenantOverrides` — an org's field-level diff against a platform
 * library row. */
export class IsraLibraryOverride extends Model<InferAttributes<IsraLibraryOverride>, InferCreationAttributes<IsraLibraryOverride>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare libType: string;
  declare platformItemId: string;
  declare fields: CreationOptional<Record<string, unknown>>;
  declare overrideVersion: CreationOptional<number>;
  declare basePlatformVersion: number | null;
  declare history: CreationOptional<IsraLibHistoryEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraLibraryOverride.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    libType: { type: DataTypes.STRING, allowNull: false, field: "lib_type" },
    platformItemId: { type: DataTypes.STRING, allowNull: false, field: "platform_item_id" },
    fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    overrideVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "override_version" },
    basePlatformVersion: { type: DataTypes.INTEGER, allowNull: true, field: "base_platform_version" },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_library_overrides", underscored: true },
);

/** `israTenantItems` — the org's own wholly-custom library rows (not
 * overriding a platform item). */
export class IsraLibraryItem extends Model<InferAttributes<IsraLibraryItem>, InferCreationAttributes<IsraLibraryItem>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare libType: string;
  declare tenantItemId: string;
  declare name: string;
  declare groupId: string | null;
  declare subgroupId: string | null;
  declare description: string | null;
  declare customFields: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraLibraryItem.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    libType: { type: DataTypes.STRING, allowNull: false, field: "lib_type" },
    tenantItemId: { type: DataTypes.STRING, allowNull: false, field: "tenant_item_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    groupId: { type: DataTypes.STRING, allowNull: true, field: "group_id" },
    subgroupId: { type: DataTypes.STRING, allowNull: true, field: "subgroup_id" },
    description: { type: DataTypes.TEXT, allowNull: true },
    customFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "custom_fields" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_library_items", underscored: true },
);

/** `israTenantArchive` — suppresses a platform item for this org. */
export class IsraLibraryArchive extends Model<InferAttributes<IsraLibraryArchive>, InferCreationAttributes<IsraLibraryArchive>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare libType: string;
  declare itemKey: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraLibraryArchive.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    libType: { type: DataTypes.STRING, allowNull: false, field: "lib_type" },
    itemKey: { type: DataTypes.STRING, allowNull: false, field: "item_key" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_library_archive", underscored: true },
);

/** `israLtAudit` — append-only; `ts`-only timestamps, matching this
 * codebase's `audit_logs` precedent. */
export class IsraLibraryAudit extends Model<InferAttributes<IsraLibraryAudit>, InferCreationAttributes<IsraLibraryAudit>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare ts: CreationOptional<Date>;
  declare actor: string | null;
  declare action: string;
  declare libType: string;
  declare key: string | null;
  declare detail: Record<string, unknown> | null;
}
IsraLibraryAudit.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actor: { type: DataTypes.STRING, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    libType: { type: DataTypes.STRING, allowNull: false, field: "lib_type" },
    key: { type: DataTypes.STRING, allowNull: true },
    detail: { type: DataTypes.JSONB, allowNull: true },
  },
  { sequelize, tableName: "isra_library_audit", underscored: true, timestamps: false },
);
