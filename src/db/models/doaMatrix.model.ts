import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * OD `doaMatrix` band approver kinds. "auto" is the auto-escalation case:
 * `doaResolveApprover` (js/modules.js:4323) resolves the band's approver at
 * runtime to the requester's next senior manager instead of a fixed name, and
 * the matrix/PR views render it as "escalation ↑" / "auto-escalated ↑"
 * (js/modules.js:4350, 3370).
 */
export type DoaApproverKind = "role" | "user" | "auto";

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
    approverKind: { type: DataTypes.ENUM("role", "user", "auto"), allowNull: false, field: "approver_kind" },
    finance: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    quotes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "doa_matrix_entries", underscored: true },
);

/** OD `doaMethodFor` (js/modules.js:4312) coerces anything but 'Order' to 'Direct'. */
export type DoaSourcingMethod = "Direct" | "Order";

/**
 * Per-category default sourcing method — OD's `db.doaMethod` map
 * (`doaMethodMap`, js/modules.js:4311), which the same Procurement Policy
 * editor reads alongside the spend bands. It is a separate collection from
 * `db.doaMatrix` because it is keyed by category, not by band: the two bands
 * of one category share a single sourcing method.
 *
 * `doaEffQuotes` (js/modules.js:4313) makes it load-bearing rather than
 * cosmetic — the effective competitive-quote requirement is the band's own
 * `quotes` flag OR the category's method being 'Order'.
 */
export class DoaMethod extends Model<InferAttributes<DoaMethod>, InferCreationAttributes<DoaMethod>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare type: string;
  declare method: DoaSourcingMethod;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

DoaMethod.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    type: { type: DataTypes.STRING, allowNull: false },
    method: { type: DataTypes.ENUM("Direct", "Order"), allowNull: false, defaultValue: "Direct" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "doa_methods", underscored: true, indexes: [{ unique: true, fields: ["org_id", "type"] }] },
);
