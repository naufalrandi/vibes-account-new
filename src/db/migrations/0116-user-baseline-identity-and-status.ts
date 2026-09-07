import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Three OD `users` facts the port had not persisted.
 *
 *  - `code` — OD's own short user identifier ('axia1', 'EU-9001', 'idtu13';
 *    js/modules.js:4480 and :5527). The Team Management table renders it in an
 *    80px "User ID" column (js/core.js:21575-21576); with only a UUID primary
 *    key that column showed a 36-character UUID.
 *  - `super_admin` — OD models super-admin as the per-USER boolean
 *    `u.superAdmin` (js/core.js:151) sitting alongside a role group drawn from
 *    the four-member `ROLE_GROUPS` (js/core.js:111). The port expressed it by
 *    swapping the role itself to a hidden "Super Admin" role, which REPLACES
 *    the role group instead of extending it and leaves the platform owner
 *    holding a group the design has no member for.
 *  - the `status` enum drops 'Inactive'. OD's user vocabulary is exactly
 *    ['Pending Activation','Active','Suspended'] (js/core.js:5226, filter
 *    options :4936) plus the 'Deleted' soft-delete marker (:4945). Nothing in
 *    this codebase ever wrote 'Inactive' to a user; any row that somehow holds
 *    it maps to 'Suspended', the nearest member of the real vocabulary.
 */
const NEW = ["Pending Activation", "Active", "Suspended", "Deleted"];
const OLD = ["Pending Activation", "Active", "Suspended", "Inactive", "Deleted"];

const quoted = (v: string[]) => v.map((x) => `'${x}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "code", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "super_admin", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  // Carry the existing role-derived flag onto the new column so nothing that
  // was super-admin stops being one.
  await q.sequelize.query(`
    UPDATE "users" SET "super_admin" = true
    WHERE "id" IN (
      SELECT ur."user_id" FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE r."is_super_admin" = true
    )
  `);

  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_users_status_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "users"
    ALTER COLUMN "status" TYPE "enum_users_status_new"
    USING (CASE "status"::text WHEN 'Inactive' THEN 'Suspended' ELSE "status"::text END)::"enum_users_status_new"
  `);
  await s.query(`DROP TYPE "enum_users_status"`);
  await s.query(`ALTER TYPE "enum_users_status_new" RENAME TO "enum_users_status"`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'Pending Activation'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_users_status_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "users"
    ALTER COLUMN "status" TYPE "enum_users_status_old" USING "status"::text::"enum_users_status_old"
  `);
  await s.query(`DROP TYPE "enum_users_status"`);
  await s.query(`ALTER TYPE "enum_users_status_old" RENAME TO "enum_users_status"`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'Pending Activation'`);
  await q.removeColumn("users", "super_admin");
  await q.removeColumn("users", "code");
};
