import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * AI feature framework (src/modules/ai/features).
 *
 * a) `ai_generations` — one row per model call made by a feature action
 *    (usage, latency, and the human review outcome of the draft).
 * b) `ai_jobs` — queued feature actions run by the worker (src/worker.ts).
 * c) `ai_feature_flags` — per-feature on/off. A row for the Service Owner org
 *    is the platform default, a row for another org overrides it for that org,
 *    no row = enabled.
 * d) `ai_schedule_runs` — last run of each scheduled feature task.
 *
 * Guarded throughout, so a re-run is a no-op.
 */
const orgFk = () => ({ type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" });
const userFk = () => ({ type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" });

export const up: Migration = async ({ context: q }) => {
  const now = () => ({ type: DataTypes.DATE, allowNull: false, defaultValue: q.sequelize.literal("NOW()") });

  if (!(await q.tableExists("ai_generations"))) {
    await q.createTable("ai_generations", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      org_id: orgFk(),
      user_id: userFk(),
      feature: { type: DataTypes.STRING(60), allowNull: false },
      action: { type: DataTypes.STRING(60), allowNull: false },
      provider: { type: DataTypes.STRING(40), allowNull: true },
      model: { type: DataTypes.STRING(200), allowNull: true },
      input_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      output_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      latency_ms: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM("draft", "accepted", "edited", "rejected", "failed"), allowNull: false, defaultValue: "draft" },
      target_type: { type: DataTypes.STRING(60), allowNull: true },
      target_id: { type: DataTypes.STRING(120), allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      created_at: now(),
      updated_at: now(),
    });
  }
  await q.sequelize.query(
    "CREATE INDEX IF NOT EXISTS ai_generations_org_feature_created ON ai_generations (org_id, feature, created_at)",
  );

  if (!(await q.tableExists("ai_jobs"))) {
    await q.createTable("ai_jobs", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      org_id: orgFk(),
      user_id: userFk(),
      feature: { type: DataTypes.STRING(60), allowNull: false },
      action: { type: DataTypes.STRING(60), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.ENUM("queued", "running", "done", "failed"), allowNull: false, defaultValue: "queued" },
      progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total: { type: DataTypes.INTEGER, allowNull: true },
      result: { type: DataTypes.JSONB, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      run_after: now(),
      locked_at: { type: DataTypes.DATE, allowNull: true },
      created_at: now(),
      updated_at: now(),
    });
  }
  await q.sequelize.query("CREATE INDEX IF NOT EXISTS ai_jobs_status_run_after ON ai_jobs (status, run_after)");

  if (!(await q.tableExists("ai_feature_flags"))) {
    await q.createTable("ai_feature_flags", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      org_id: orgFk(),
      feature: { type: DataTypes.STRING(60), allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false },
      updated_by: userFk(),
      created_at: now(),
      updated_at: now(),
    });
  }
  await q.sequelize.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS ai_feature_flags_org_feature ON ai_feature_flags (org_id, feature)",
  );

  if (!(await q.tableExists("ai_schedule_runs"))) {
    await q.createTable("ai_schedule_runs", {
      key: { type: DataTypes.STRING(100), primaryKey: true },
      last_run_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    const run = (sql: string) => q.sequelize.query(sql, { transaction });
    await run("DROP TABLE IF EXISTS ai_schedule_runs");
    await run("DROP TABLE IF EXISTS ai_feature_flags");
    await run("DROP TABLE IF EXISTS ai_jobs");
    await run("DROP TABLE IF EXISTS ai_generations");
    await run("DROP TYPE IF EXISTS enum_ai_jobs_status");
    await run("DROP TYPE IF EXISTS enum_ai_generations_status");
  });
};
