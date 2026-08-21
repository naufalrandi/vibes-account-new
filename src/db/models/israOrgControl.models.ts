import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group C (migration 0063): org-level control customization +
 * clause maturity baselines (design doc §2.5). `IsraOrgControl` deliberately
 * holds only rows an org actually customized/added — not a full 93-row
 * clone per org like OD's in-memory shortcut. Effective control = the org
 * row if one exists for `(orgId, ref)`, else `IsraAnnexAControl` (service
 * layer, later batch).
 */
export const ISRA_OVERLAY_KIND = ["suppress", "add"] as const;
export type IsraOverlayKind = (typeof ISRA_OVERLAY_KIND)[number];

export class IsraOrgControl extends Model<InferAttributes<IsraOrgControl>, InferCreationAttributes<IsraOrgControl>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare ref: string;
  declare custom: CreationOptional<boolean>;
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
IsraOrgControl.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    ref: { type: DataTypes.STRING, allowNull: false },
    custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
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
  { sequelize, tableName: "isra_org_controls", underscored: true },
);

/** `israCtlBaseline` — the org's generic per-clause maturity, reused by every
 * Existing Control mapped to that clause unless overridden per-control
 * (`IsraExistingControl.maturityByRef`). */
export class IsraControlMaturityBaseline extends Model<InferAttributes<IsraControlMaturityBaseline>, InferCreationAttributes<IsraControlMaturityBaseline>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare annexRef: string;
  declare gov: number | null;
  declare doc: number | null;
  declare impl: number | null;
  declare mon: number | null;
  declare comp: number | null;
  declare setBy: string | null;
  declare setAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraControlMaturityBaseline.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    gov: { type: DataTypes.INTEGER, allowNull: true },
    doc: { type: DataTypes.INTEGER, allowNull: true },
    impl: { type: DataTypes.INTEGER, allowNull: true },
    mon: { type: DataTypes.INTEGER, allowNull: true },
    comp: { type: DataTypes.INTEGER, allowNull: true },
    setBy: { type: DataTypes.STRING, allowNull: true, field: "set_by" },
    setAt: { type: DataTypes.DATE, allowNull: true, field: "set_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_control_maturity_baselines", underscored: true },
);

/** `israMapVulnControlOverlay` — per-tenant suppress/add layer on top of the
 * platform Vuln→Annex A map (design doc §1.3: base + tenant-overlay, not a
 * legacy/live pair). `edgeId` is only set for `kind:'suppress'`; the
 * `vulnId`/`annexRef`/role/affects/strength/mechanism quartet is only
 * populated for `kind:'add'`. */
export class IsraVulnControlOverlay extends Model<InferAttributes<IsraVulnControlOverlay>, InferCreationAttributes<IsraVulnControlOverlay>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare kind: string;
  declare edgeId: string | null;
  declare vulnId: string | null;
  declare annexRef: string | null;
  declare role: string | null;
  declare affects: string | null;
  declare strength: string | null;
  declare mechanism: string | null;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraVulnControlOverlay.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    kind: { type: DataTypes.STRING, allowNull: false },
    edgeId: { type: DataTypes.STRING, allowNull: true, field: "edge_id" },
    vulnId: { type: DataTypes.STRING, allowNull: true, field: "vuln_id" },
    annexRef: { type: DataTypes.STRING, allowNull: true, field: "annex_ref" },
    role: { type: DataTypes.STRING, allowNull: true },
    affects: { type: DataTypes.STRING, allowNull: true },
    strength: { type: DataTypes.STRING, allowNull: true },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_vuln_control_overlay", underscored: true },
);
