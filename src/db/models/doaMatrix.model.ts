import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type DoaApproverKind = "role" | "user";

/**
 * Delegation-of-Authority spend-band matrix entry (OD `db.doaMatrix`, SOF-58 §3).
 * Each row is a spend category ("Vehicle", "Electronics - Endpoint Devices", ...)
 * with a ceiling amount, the required approver (a role name or a specific
 * person), and finance/competing-quotes sign-off flags. Distinct from
 * `ApprovalScheme.gates` (pure workflow-gate sequencing) — this is the spend
 * threshold table that decides *who* must approve *how much*, not the gate
 * sequence itself. `max` is nullable to represent "no spend ceiling" (one
 * sampled design record had `max: ""`).
 */
export class DoaMatrixEntry extends Model<
  InferAttributes<DoaMatrixEntry>,
  InferCreationAttributes<DoaMatrixEntry>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare type: string;
  declare max: number | null;
  declare currency: CreationOptional<string>;
  declare approver: string;
  declare approverKind: DoaApproverKind;
  declare finance: CreationOptional<boolean>;
  declare quotes: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

DoaMatrixEntry.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    type: { type: DataTypes.STRING, allowNull: false },
    max: { type: DataTypes.DECIMAL, allowNull: true },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    approver: { type: DataTypes.STRING, allowNull: false },
    approverKind: { type: DataTypes.ENUM("role", "user"), allowNull: false, field: "approver_kind" },
    finance: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    quotes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "doa_matrix_entries", underscored: true },
);
