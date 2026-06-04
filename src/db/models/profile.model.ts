import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type ProfileStatus = "Active" | "Inactive";

/**
 * A named access configuration / user profile template owned by an organization.
 * Every row is scoped to its `orgId`; the value is always taken from the
 * authenticated context, never from client input, so an organization can only
 * ever read or mutate its own profiles.
 */
export class Profile extends Model<
  InferAttributes<Profile>,
  InferCreationAttributes<Profile>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare description: string | null;
  declare status: CreationOptional<ProfileStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Profile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "profiles", underscored: true },
);
