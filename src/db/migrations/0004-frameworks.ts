import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Completes the `frameworks` table (created as a minimal placeholder in 0003)
 * with the full master-catalog schema: a unique required code, version, a
 * publish-lifecycle status, published date, and short/full descriptions. The
 * table is brand-new and empty everywhere this runs, so tightening `code` to
 * NOT NULL + UNIQUE needs no backfill.
 */
export const up: Migration = async ({ context: q }) => {
  await q.changeColumn("frameworks", "code", { type: DataTypes.STRING, allowNull: false });
  await q.addConstraint("frameworks", { fields: ["code"], type: "unique", name: "frameworks_code_unique" });

  await q.addColumn("frameworks", "version", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("frameworks", "status", {
    type: DataTypes.ENUM("Draft", "Published", "Archived"),
    allowNull: false,
    defaultValue: "Draft",
  });
  await q.addColumn("frameworks", "published_date", { type: DataTypes.DATEONLY, allowNull: true });
  await q.addColumn("frameworks", "short_description", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("frameworks", "full_description", { type: DataTypes.TEXT, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("frameworks", "full_description");
  await q.removeColumn("frameworks", "short_description");
  await q.removeColumn("frameworks", "published_date");
  await q.removeColumn("frameworks", "status");
  await q.removeColumn("frameworks", "version");
  await q.removeConstraint("frameworks", "frameworks_code_unique");
  await q.changeColumn("frameworks", "code", { type: DataTypes.STRING, allowNull: true });
};
