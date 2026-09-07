import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * R496 — the Delegation-of-Authority matrix had grown two backend homes.
 *
 * OD keeps one collection per thing: `db.doaMatrix` holds the spend bands and
 * `db.doaMethod` the per-category sourcing method, and one Procurement Policy
 * editor reads both (`doaSeedIfNeeded`/`doaMethodMap`, js/modules.js:4293-4315).
 * This port ended up with two: `doa_matrix_entries` + `doa_methods` (0085/0104,
 * served at /v1/doa-matrix), which nothing in the frontend ever called, and the
 * `ent-doa` `business_records` rows that `EnterpriseProcurementPolicyPage`
 * actually lists and writes.
 *
 * The `ent-doa` register wins because it is the one the screen reads; its bands
 * and sourcing methods are seeded by `businessRecordsSeed` and validated by
 * `entDoaDataSchema`. These two tables, their model, seeder, service and mount
 * go with this migration. Postgres keeps the ENUM types behind after a
 * `DROP TABLE`, so drop those explicitly too.
 */
export const up: Migration = async ({ context: q }) => {
  await q.dropTable("doa_methods");
  await q.dropTable("doa_matrix_entries");
  await q.sequelize.query(`DROP TYPE IF EXISTS "enum_doa_methods_method"`);
  await q.sequelize.query(`DROP TYPE IF EXISTS "enum_doa_matrix_entries_approver_kind"`);
};

/**
 * Recreates both tables as 0085 + 0099 + 0104 left them — `approver_kind`
 * carries the 'auto' member 0099 added, so a down/up round trip lands on the
 * same shape. The rows themselves are not restored; `seedDoaMatrix` is gone.
 */
export const down: Migration = async ({ context: q }) => {
  await q.createTable("doa_matrix_entries", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    type: { type: DataTypes.STRING, allowNull: false },
    max: { type: DataTypes.DECIMAL, allowNull: true },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    approver: { type: DataTypes.STRING, allowNull: false },
    approver_kind: { type: DataTypes.ENUM("role", "user", "auto"), allowNull: false },
    finance: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    quotes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("doa_matrix_entries", ["org_id"]);
  await q.createTable("doa_methods", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    type: { type: DataTypes.STRING, allowNull: false },
    method: { type: DataTypes.ENUM("Direct", "Order"), allowNull: false, defaultValue: "Direct" },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  await q.addIndex("doa_methods", ["org_id", "type"], { unique: true, name: "doa_methods_org_id_type_uk" });
};
