import { DataTypes } from "sequelize";
import { randomUUID } from "node:crypto";
import type { Migration } from "../migrate";

/**
 * Phase 1 catalog cutover (additive step). Adds the AXIA framework shape onto the
 * existing `frameworks` table — a FrameworkGroup (Standards / Regulations) plus
 * jurisdictions and a single description — and seeds the two fixed groups. The
 * legacy `family_id`/`code` columns and the old type/family/catalog tables are
 * retired in the removal step; this migration is non-destructive so the app keeps
 * working throughout.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("frameworks", "group_id", {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "framework_groups", key: "id" },
    onDelete: "SET NULL",
  });
  await q.addColumn("frameworks", "jurisdictions", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("frameworks", "description", { type: DataTypes.TEXT, allowNull: true });
  await q.addIndex("frameworks", ["group_id"]);

  const now = new Date();
  await q.bulkInsert("framework_groups", [
    { id: randomUUID(), name: "Standards", created_at: now, updated_at: now },
    { id: randomUUID(), name: "Regulations", created_at: now, updated_at: now },
  ]);
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("frameworks", "description");
  await q.removeColumn("frameworks", "jurisdictions");
  await q.removeColumn("frameworks", "group_id");
  await q.bulkDelete("framework_groups", {});
};
