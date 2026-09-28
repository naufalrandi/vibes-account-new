import { randomUUID } from "node:crypto";
import { DataTypes, QueryTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Platform AI connection (src/lib/ai, /v1/ai).
 *
 * a) `ai_connections` — one row per org (today only the Service Owner's is
 *    read). The API key is stored only as AES-256-GCM ciphertext + IV + tag
 *    (src/lib/secretBox.ts) and its last four characters.
 * b) `ai.settings.read` / `ai.settings.manage` under the Organization Settings
 *    menu, granted to every Service Owner role that is super-admin or already
 *    holds `org.update` (the grant behind the Organization Settings page).
 *    A fresh database gets both from the seeder (MENU_SEED) instead, so when the
 *    menu is not there yet this step is a no-op.
 *
 * Guarded throughout, so a re-run is a no-op.
 */
const AI_ACTIONS: [key: string, name: string, sorting: number][] = [
  ["ai.settings.read", "View AI connection", 90],
  ["ai.settings.manage", "Manage AI connection", 91],
];

export const up: Migration = async ({ context: q }) => {
  if (!(await q.tableExists("ai_connections"))) {
    await q.createTable("ai_connections", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      org_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
      provider: { type: DataTypes.ENUM("anthropic", "openai"), allowNull: false },
      base_url: { type: DataTypes.TEXT, allowNull: false },
      api_key_ciphertext: { type: DataTypes.TEXT, allowNull: true },
      api_key_iv: { type: DataTypes.TEXT, allowNull: true },
      api_key_tag: { type: DataTypes.TEXT, allowNull: true },
      api_key_last4: { type: DataTypes.STRING(4), allowNull: true },
      model: { type: DataTypes.STRING(200), allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      max_output_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4096 },
      timeout_ms: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60000 },
      last_test_at: { type: DataTypes.DATE, allowNull: true },
      last_test_ok: { type: DataTypes.BOOLEAN, allowNull: true },
      last_test_latency_ms: { type: DataTypes.INTEGER, allowNull: true },
      last_test_error: { type: DataTypes.TEXT, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: q.sequelize.literal("NOW()") },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: q.sequelize.literal("NOW()") },
    });
  }

  await q.sequelize.transaction(async (transaction) => {
    const select = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) =>
      q.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const run = (sql: string, replacements: Record<string, unknown>) => q.sequelize.query(sql, { replacements, transaction });

    const [menu] = await select<{ id: string }>(
      "SELECT id FROM menus WHERE route = '/settings' AND name = 'Organization Settings' ORDER BY created_at LIMIT 1",
    );
    if (!menu) return;
    for (const [key, name, sorting] of AI_ACTIONS) {
      await run(
        `INSERT INTO actions (id, menu_id, key, name, sorting, status, created_at, updated_at)
         VALUES (:id, :menuId, :key, :name, :sorting, true, NOW(), NOW()) ON CONFLICT (key) DO NOTHING`,
        { id: randomUUID(), menuId: menu.id, key, name, sorting },
      );
    }
    const actions = await select<{ id: string }>("SELECT id FROM actions WHERE key IN (:keys)", { keys: AI_ACTIONS.map(([k]) => k) });
    const roles = await select<{ id: string }>(
      `SELECT r.id FROM roles r
        WHERE r.tier_scope = 'ServiceOwner'
          AND (r.is_super_admin OR EXISTS (
                SELECT 1 FROM role_action_grants g JOIN actions a ON a.id = g.action_id
                 WHERE g.role_id = r.id AND g.granted AND a.key = 'org.update'))`,
    );
    for (const role of roles) {
      for (const action of actions) {
        await run(
          `INSERT INTO role_action_grants (id, role_id, action_id, granted)
           VALUES (:id, :roleId, :actionId, true) ON CONFLICT (role_id, action_id) DO NOTHING`,
          { id: randomUUID(), roleId: role.id, actionId: action.id },
        );
      }
    }
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    const run = (sql: string) => q.sequelize.query(sql, { transaction });
    await run("DELETE FROM role_action_grants WHERE action_id IN (SELECT id FROM actions WHERE key LIKE 'ai.settings.%')");
    await run("DELETE FROM actions WHERE key LIKE 'ai.settings.%'");
    await run("DROP TABLE IF EXISTS ai_connections");
    await run("DROP TYPE IF EXISTS enum_ai_connections_provider");
  });
};
