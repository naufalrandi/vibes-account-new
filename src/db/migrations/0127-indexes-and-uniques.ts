import type { QueryInterface } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Missing indexes on hot lookup paths (auth refresh, login history, org tree,
 * role/tenant scoping, audit feed), plus case-insensitive uniqueness that the
 * application already assumes.
 *
 * Plain CREATE INDEX (not CONCURRENTLY): boot migrations run while
 * migrateUpLocked() holds an open advisory-lock transaction, which a
 * concurrent build would wait on forever. These tables are small enough that a
 * brief write lock at deploy time is fine.
 */
const INDEXES: [name: string, table: string, cols: string][] = [
  ["refresh_tokens_user_id_token_hash_idx", "refresh_tokens", "user_id, token_hash"],
  ["refresh_tokens_token_hash_idx", "refresh_tokens", "token_hash"],
  ["login_history_user_id_idx", "login_history", "user_id"],
  ["roles_org_id_name_idx", "roles", "org_id, name"],
  ["organizations_parent_org_id_idx", "organizations", "parent_org_id"],
  ["organizations_tenant_id_idx", "organizations", "tenant_id"],
  ["organizations_type_idx", "organizations", "type"],
  ["subscriptions_org_id_idx", "subscriptions", "org_id"],
  ["user_roles_role_id_idx", "user_roles", "role_id"],
  ["tenant_profiles_partner_org_id_idx", "tenant_profiles", "partner_org_id"],
  ["audit_logs_tenant_id_at_idx", "audit_logs", "tenant_id, at"],
];

/** Unique indexes, each created only when the existing data already satisfies it. */
const UNIQUES: { name: string; create: string; dupCheck: string }[] = [
  {
    name: "users_email_lower_active_uq",
    create: `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_active_uq ON users (lower(email)) WHERE status <> 'Deleted'`,
    dupCheck: `SELECT lower(email) AS k FROM users WHERE status <> 'Deleted' GROUP BY 1 HAVING count(*) > 1 LIMIT 5`,
  },
  {
    name: "users_username_lower_active_uq",
    create: `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_active_uq ON users (lower(username)) WHERE status <> 'Deleted'`,
    dupCheck: `SELECT lower(username) AS k FROM users WHERE status <> 'Deleted' GROUP BY 1 HAVING count(*) > 1 LIMIT 5`,
  },
  {
    name: "roles_org_id_name_uq",
    create: `CREATE UNIQUE INDEX IF NOT EXISTS roles_org_id_name_uq ON roles (org_id, name)`,
    dupCheck: `SELECT org_id || ':' || name AS k FROM roles GROUP BY org_id, name HAVING count(*) > 1 LIMIT 5`,
  },
];

async function createUniqueIfClean(q: QueryInterface, u: (typeof UNIQUES)[number]): Promise<void> {
  const [dups] = (await q.sequelize.query(u.dupCheck)) as [{ k: string }[], unknown];
  if (dups.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[0127] skipping ${u.name}: duplicate keys exist (${dups.map((d) => d.k).join(", ")}) — dedupe, then re-create it`);
    return;
  }
  await q.sequelize.query(u.create);
}

export const up: Migration = async ({ context: q }) => {
  for (const [name, table, cols] of INDEXES) {
    await q.sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols})`);
  }
  for (const u of UNIQUES) await createUniqueIfClean(q, u);
};

export const down: Migration = async ({ context: q }) => {
  for (const { name } of UNIQUES) await q.sequelize.query(`DROP INDEX IF EXISTS ${name}`);
  for (const [name] of INDEXES) await q.sequelize.query(`DROP INDEX IF EXISTS ${name}`);
};
