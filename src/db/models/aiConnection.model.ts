import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

export type AiProvider = "anthropic" | "openai";

/**
 * The platform AI connection (src/lib/ai). One row, owned by the Service Owner
 * org; `orgId` is unique so per-org overrides can be added later without a
 * schema change. The API key is stored only as AES-256-GCM ciphertext
 * (src/lib/secretBox.ts) plus its last four characters for display.
 */
export class AiConnection extends Model<InferAttributes<AiConnection>, InferCreationAttributes<AiConnection>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare provider: AiProvider;
  declare baseUrl: string;
  declare apiKeyCiphertext: string | null;
  declare apiKeyIv: string | null;
  declare apiKeyTag: string | null;
  declare apiKeyLast4: string | null;
  declare model: string;
  declare enabled: CreationOptional<boolean>;
  declare maxOutputTokens: CreationOptional<number>;
  declare timeoutMs: CreationOptional<number>;
  declare lastTestAt: Date | null;
  declare lastTestOk: boolean | null;
  declare lastTestLatencyMs: number | null;
  declare lastTestError: string | null;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AiConnection.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    provider: { type: DataTypes.ENUM("anthropic", "openai"), allowNull: false },
    baseUrl: { type: DataTypes.TEXT, allowNull: false, field: "base_url" },
    apiKeyCiphertext: { type: DataTypes.TEXT, allowNull: true, field: "api_key_ciphertext" },
    apiKeyIv: { type: DataTypes.TEXT, allowNull: true, field: "api_key_iv" },
    apiKeyTag: { type: DataTypes.TEXT, allowNull: true, field: "api_key_tag" },
    apiKeyLast4: { type: DataTypes.STRING(4), allowNull: true, field: "api_key_last4" },
    model: { type: DataTypes.STRING(200), allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    maxOutputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4096, field: "max_output_tokens" },
    timeoutMs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60000, field: "timeout_ms" },
    lastTestAt: { type: DataTypes.DATE, allowNull: true, field: "last_test_at" },
    lastTestOk: { type: DataTypes.BOOLEAN, allowNull: true, field: "last_test_ok" },
    lastTestLatencyMs: { type: DataTypes.INTEGER, allowNull: true, field: "last_test_latency_ms" },
    lastTestError: { type: DataTypes.TEXT, allowNull: true, field: "last_test_error" },
    updatedBy: { type: DataTypes.UUID, allowNull: true, field: "updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ai_connections", underscored: true },
);
