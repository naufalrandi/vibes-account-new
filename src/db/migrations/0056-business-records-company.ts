import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Wave C: Operating company scoping (AXIA vs Exelera).
 * Adds `company` VARCHAR column to `business_records` with default 'axia',
 * and an index on (org_id, area, module, company).
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("business_records", "company", {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "axia",
  });
  await q.addIndex("business_records", ["org_id", "area", "module", "company"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.removeIndex("business_records", ["org_id", "area", "module", "company"]);
  await q.removeColumn("business_records", "company");
};
