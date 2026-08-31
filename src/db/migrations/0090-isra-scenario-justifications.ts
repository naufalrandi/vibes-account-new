import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-327 (SOF-167 gap register) — two scenario-level justification/context
 * fields OD captures but the port never persisted:
 *  - `isra2LikeNoteEdit`'s likelihood justification (core.js:14576,
 *    `sc.likelihoodNote`).
 *  - `isra2CiaDescEdit`'s per-CIA-letter loss context (core.js:14515,
 *    `sc.ciaDesc={c,i,a}`).
 * (The per-impact-area justification `isra2NoteEdit` sets, core.js:14570,
 * already has a column — `isra_scenario_potential_impacts.note`, migration
 * 0065 — so it needs no schema change, only FE wiring.)
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_scenarios", "likelihood_note", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_scenarios", "cia_desc", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenarios", "cia_desc");
  await q.removeColumn("isra_scenarios", "likelihood_note");
};
