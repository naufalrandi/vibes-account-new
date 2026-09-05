import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group A part 1 (migration 0060): global reference data, no
 * `org_id`. The Annex A master, Threat/Vuln libraries, and the
 * Group→Subgroup taxonomy for Primary/Secondary assets. See
 * `docs/isra-schema-design.md` §2.3.
 *
 * `IsraThreatLibrary`/`IsraVulnLibrary`/`IsraPaGroup`/`IsraPaSubgroup`/
 * `IsraSaGroup`/`IsraSaSubgroup` use the OD business-key string (`THR-…`
 * etc.) as their primary key, not a generated UUID — that string is what
 * every downstream org-scoped table references (design doc §2.10).
 */

/**
 * OD offers exactly `Under review` / `Approved` / `Rejected` in the SA
 * knowledge-map review select (`isra2SaKmReportBody`, js/core.js:15784), and
 * seeds every sub-group `Under review` (js/core.js:16536). `Rejected` was
 * missing here. `Draft`/`Retired` are port-only extras kept because the
 * status endpoint's contract test pins them
 * (src/modules/isra/isra.integration.test.ts:87,100).
 */
export const ISRA_SA_SUBGROUP_STATUS = ["Draft", "Under review", "Approved", "Rejected", "Retired"] as const;
export type IsraSaSubgroupStatus = (typeof ISRA_SA_SUBGROUP_STATUS)[number];

export const ISRA_LIB_ITEM_STATUS = ["Active", "Retired"] as const;
export type IsraLibItemStatus = (typeof ISRA_LIB_ITEM_STATUS)[number];

export class IsraAnnexAControl extends Model<InferAttributes<IsraAnnexAControl>, InferCreationAttributes<IsraAnnexAControl>> {
  declare ref: string;
  declare name: string;
  declare category: string | null;
  declare csf: string | null;
  declare type: string | null;
  declare fnP: CreationOptional<boolean>;
  declare fnD: CreationOptional<boolean>;
  declare fnC: CreationOptional<boolean>;
  declare dedL: CreationOptional<boolean>;
  declare dedC: CreationOptional<boolean>;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAnnexAControl.init(
  {
    ref: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    csf: { type: DataTypes.STRING, allowNull: true },
    type: { type: DataTypes.STRING, allowNull: true },
    fnP: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "fn_p" },
    fnD: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "fn_d" },
    fnC: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "fn_c" },
    dedL: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "ded_l" },
    dedC: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "ded_c" },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_annex_a_controls", underscored: true },
);

export class IsraThreatLibrary extends Model<InferAttributes<IsraThreatLibrary>, InferCreationAttributes<IsraThreatLibrary>> {
  declare id: string;
  declare name: string;
  declare category: string | null;
  declare description: string | null;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraThreatLibrary.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_threat_library", underscored: true },
);

export class IsraVulnLibrary extends Model<InferAttributes<IsraVulnLibrary>, InferCreationAttributes<IsraVulnLibrary>> {
  declare id: string;
  declare name: string;
  declare category: string | null;
  declare description: string | null;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraVulnLibrary.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_vuln_library", underscored: true },
);

export class IsraPaGroup extends Model<InferAttributes<IsraPaGroup>, InferCreationAttributes<IsraPaGroup>> {
  declare id: string;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraPaGroup.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_pa_groups", underscored: true },
);

export class IsraPaSubgroup extends Model<InferAttributes<IsraPaSubgroup>, InferCreationAttributes<IsraPaSubgroup>> {
  declare id: string;
  declare groupId: string;
  declare name: string;
  declare description: string | null;
  declare examples: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraPaSubgroup.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    groupId: { type: DataTypes.STRING, allowNull: false, field: "group_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    examples: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_pa_subgroups", underscored: true },
);

export class IsraSaGroup extends Model<InferAttributes<IsraSaGroup>, InferCreationAttributes<IsraSaGroup>> {
  declare id: string;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraSaGroup.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_sa_groups", underscored: true },
);

/** `status`/`version` are what `israSaSubApproved` gates V2 baseline auto-load
 * on (design doc §1.2) — an unapproved subgroup's baseline threats/vulns
 * don't auto-apply. */
export class IsraSaSubgroup extends Model<InferAttributes<IsraSaSubgroup>, InferCreationAttributes<IsraSaSubgroup>> {
  declare id: string;
  declare groupId: string;
  declare name: string;
  declare description: string | null;
  declare examples: CreationOptional<string[]>;
  declare status: CreationOptional<string>;
  declare version: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraSaSubgroup.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    groupId: { type: DataTypes.STRING, allowNull: false, field: "group_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    examples: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_sa_subgroups", underscored: true },
);
