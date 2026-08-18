import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * `spApprove` clones a superseded scope version with a brand-new `code`
 * (`nextCode()`), so the Versions tab's "same code" filter can never surface
 * it. OD doesn't hit this because its clone (`msApproveSP`, index.html
 * ~9812-9826) keeps the same `id`-derived identity implicitly — there's no
 * separate code/lineage split there. On the versioned/relational BE side we
 * need an explicit `lineage_id` that both the original scope and every clone
 * created off it share, so version history can be queried by lineage instead
 * of by code (which is meant to be a unique per-row identifier, not a
 * version-family key).
 *
 * Backfill: every existing row becomes the head of its own lineage
 * (`lineage_id = id`) since, pre-fix, superseded clones already have their
 * own disconnected code/id and cannot be reattached to their true origin
 * after the fact.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("ms_scopes", "lineage_id", { type: DataTypes.UUID, allowNull: true });
  await q.sequelize.query(`UPDATE "ms_scopes" SET "lineage_id" = "id" WHERE "lineage_id" IS NULL`);
  await q.changeColumn("ms_scopes", "lineage_id", { type: DataTypes.UUID, allowNull: false });
  await q.addIndex("ms_scopes", ["lineage_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.removeIndex("ms_scopes", ["lineage_id"]);
  await q.removeColumn("ms_scopes", "lineage_id");
};
