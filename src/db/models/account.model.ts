import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type AccountStatus = "Active" | "Inactive";

/**
 * A linked external / system account owned by an organization (e.g. a connected
 * provider account). Scoped to its `orgId`, always resolved from the
 * authenticated context, so cross-organization reads or mutations are not
 * possible. `provider`, `externalId`, and `role` are free-form descriptors of
 * the linked system.
 */
export class Account extends Model<
  InferAttributes<Account>,
  InferCreationAttributes<Account>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare description: string | null;
  declare provider: string | null;
  declare externalId: string | null;
  declare role: string | null;
  declare status: CreationOptional<AccountStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Account.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    provider: { type: DataTypes.STRING, allowNull: true },
    externalId: { type: DataTypes.STRING, allowNull: true, field: "external_id" },
    role: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "accounts", underscored: true },
);
