import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * B4 — `kb.service.ts` used to increment `views` AND `uniqueViews` on every
 * open, so `uniqueViews === views` always (OD dedupes per session,
 * app.html:26927). Add per-viewer tracking so `uniqueViews` only grows on a
 * user's first view: `viewer_ids` is the JSONB array of user ids that have
 * already been counted. Same idea for votes (`vote()`, kb.service.ts
 * :177-185, had no dedupe either) — `voter_ids` is a JSONB map of
 * userId -> "helpful" | "notHelpful" so a repeat vote is a no-op and a
 * changed vote moves the count instead of double-adding.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("kb_articles", "viewer_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("kb_articles", "voter_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("kb_articles", "voter_ids");
  await q.removeColumn("kb_articles", "viewer_ids");
};
