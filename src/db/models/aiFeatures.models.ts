import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

/** AI feature framework tables (migration 0130, src/modules/ai/features). */

export type AiGenerationStatus = "draft" | "accepted" | "edited" | "rejected" | "failed";
export type AiJobStatus = "queued" | "running" | "done" | "failed";

/** One model call made by a feature action, and the human review outcome of its draft. */
export class AiGeneration extends Model<InferAttributes<AiGeneration>, InferCreationAttributes<AiGeneration>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string | null;
  declare feature: string;
  declare action: string;
  declare provider: string | null;
  declare model: string | null;
  declare inputTokens: CreationOptional<number>;
  declare outputTokens: CreationOptional<number>;
  declare latencyMs: number | null;
  declare status: CreationOptional<AiGenerationStatus>;
  declare targetType: string | null;
  declare targetId: string | null;
  declare error: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AiGeneration.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: true, field: "user_id" },
    feature: { type: DataTypes.STRING(60), allowNull: false },
    action: { type: DataTypes.STRING(60), allowNull: false },
    provider: { type: DataTypes.STRING(40), allowNull: true },
    model: { type: DataTypes.STRING(200), allowNull: true },
    inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "input_tokens" },
    outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "output_tokens" },
    latencyMs: { type: DataTypes.INTEGER, allowNull: true, field: "latency_ms" },
    status: { type: DataTypes.ENUM("draft", "accepted", "edited", "rejected", "failed"), allowNull: false, defaultValue: "draft" },
    targetType: { type: DataTypes.STRING(60), allowNull: true, field: "target_type" },
    targetId: { type: DataTypes.STRING(120), allowNull: true, field: "target_id" },
    error: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ai_generations", underscored: true },
);

/** A feature action queued for the worker (src/worker.ts). `payload` is the validated action input. */
export class AiJob extends Model<InferAttributes<AiJob>, InferCreationAttributes<AiJob>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string | null;
  declare feature: string;
  declare action: string;
  declare payload: unknown;
  declare status: CreationOptional<AiJobStatus>;
  declare progress: CreationOptional<number>;
  declare total: number | null;
  declare result: unknown;
  declare error: string | null;
  declare attempts: CreationOptional<number>;
  declare runAfter: CreationOptional<Date>;
  declare lockedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AiJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: true, field: "user_id" },
    feature: { type: DataTypes.STRING(60), allowNull: false },
    action: { type: DataTypes.STRING(60), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.ENUM("queued", "running", "done", "failed"), allowNull: false, defaultValue: "queued" },
    progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.INTEGER, allowNull: true },
    result: { type: DataTypes.JSONB, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "run_after" },
    lockedAt: { type: DataTypes.DATE, allowNull: true, field: "locked_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ai_jobs", underscored: true },
);

/** Service Owner org row = platform default for the feature; any other org's row overrides it there. */
export class AiFeatureFlag extends Model<InferAttributes<AiFeatureFlag>, InferCreationAttributes<AiFeatureFlag>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare feature: string;
  declare enabled: boolean;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AiFeatureFlag.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    feature: { type: DataTypes.STRING(60), allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false },
    updatedBy: { type: DataTypes.UUID, allowNull: true, field: "updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ai_feature_flags", underscored: true },
);

/** Last run of a scheduled feature task, keyed by the schedule's key. */
export class AiScheduleRun extends Model<InferAttributes<AiScheduleRun>, InferCreationAttributes<AiScheduleRun>> {
  declare key: string;
  declare lastRunAt: Date;
}
AiScheduleRun.init(
  {
    key: { type: DataTypes.STRING(100), primaryKey: true },
    lastRunAt: { type: DataTypes.DATE, allowNull: false, field: "last_run_at" },
  },
  { sequelize, tableName: "ai_schedule_runs", underscored: true, timestamps: false },
);
