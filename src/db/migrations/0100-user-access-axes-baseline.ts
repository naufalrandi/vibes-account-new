import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Completes the OD access-axes record. Migration 0088 persisted the *access*
 * halves of OD `acSave` (js/core.js:5210-5242) — `entAccess`/`entPerms` and
 * `units`/`unitAccess`/`unitPerms` — but left out the two things acSave writes
 * alongside them, so a saved access configuration could not be replayed:
 *
 *  - `nav_perms` — the granted Service Provider MENU key set (js/core.js:5225,
 *    `u.navPerms=keys.slice()`). The existing `permissions` column only holds
 *    the derived module list (`acNavToModules`, js/core.js:5003-5006), which is
 *    lossy: several menu keys map to no module at all, so the menu-level grant
 *    cannot be reconstructed from it. `acInit` reads `u.navPerms` back
 *    (js/core.js:5086) when an Administrator is in Custom Access mode.
 *  - the per-menu action maps `nav_actions` (js/core.js:5223/5236),
 *    `ent_actions` (5232/5235) and `unit_actions` (5242) — which of the nine
 *    ARCH_ACTIONS verbs are granted on each menu key. Without them every menu
 *    grant is all-or-nothing.
 *
 * Existing rows predate the axes and get the OD "nothing configured yet"
 * values: an empty key list and empty maps. `acInit` treats a missing/empty
 * map as "seed from the role's default level" (js/core.js:5091-5093), which is
 * the same behaviour those rows have today.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "nav_perms", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("users", "nav_actions", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  await q.addColumn("users", "ent_actions", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  await q.addColumn("users", "unit_actions", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "unit_actions");
  await q.removeColumn("users", "ent_actions");
  await q.removeColumn("users", "nav_actions");
  await q.removeColumn("users", "nav_perms");
};
