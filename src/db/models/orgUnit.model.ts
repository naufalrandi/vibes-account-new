import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Enterprise org-structure node. `tier` is derived from depth (root=A .. E)
 * by `retier` on create/reparent — never accept it directly as free input.
 * `appt`: employment-level code (e.g. "L1") -> appointed user id.
 */
export class OrgUnit extends Model<InferAttributes<OrgUnit>, InferCreationAttributes<OrgUnit>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare parentId: string | null;
  declare tier: CreationOptional<string>;
  declare appt: CreationOptional<Record<string, string>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

OrgUnit.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    parentId: { type: DataTypes.UUID, allowNull: true, field: "parent_id" },
    tier: { type: DataTypes.STRING, allowNull: false, defaultValue: "A" },
    appt: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "org_units", underscored: true },
);
