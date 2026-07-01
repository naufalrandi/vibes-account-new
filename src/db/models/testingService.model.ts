import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type LimsStageState = "Mandatory" | "Optional" | "Not Applicable";
/** Per-service state of each of the 5 configurable workflow stages. */
export type StageConfig = Record<string, LimsStageState>;

/** A laboratory testing service line defined on the configurable workflow engine. */
export class TestingService extends Model<
  InferAttributes<TestingService>,
  InferCreationAttributes<TestingService>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare status: CreationOptional<"Active" | "Inactive">;
  declare stages: CreationOptional<StageConfig>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

TestingService.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    stages: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "testing_services", underscored: true },
);
