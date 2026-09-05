import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD keeps the per-category sourcing method in `db.doaMethod` (`doaMethodMap`,
 * js/modules.js:4311) — a sibling of `db.doaMatrix`, read by the same
 * Procurement Policy editor. It had no backend home here: the screen stored it
 * as an untyped `business_records` blob (`data.kind: "method"`) that no seeder
 * ever wrote, so the editor came up with no method for any category.
 *
 * Seeded per OD: 'Order' for Professional Services, 'Direct' for the other ten
 * categories (js/modules.js:4311).
 */
export const up: Migration = async ({ context: q }) => {
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

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("doa_methods");
};
