import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-84 (split out of SOF-74) — persists the two member-level access axes the
 * FE access workspace configures alongside the Service Provider grid (OD
 * `acSave`, js/core.js:5210-5240): Enterprise system-of-record access
 * (`entAccess`/`entPerms`) and per-business-unit grants (`units`/`unitAccess`/
 * `unitPerms`). Previously these were accepted by the FE mock client only —
 * the real PATCH /users/:id stripped them.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "ent_access", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await q.addColumn("users", "ent_perms", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("users", "units", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("users", "unit_access", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  await q.addColumn("users", "unit_perms", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "unit_perms");
  await q.removeColumn("users", "unit_access");
  await q.removeColumn("users", "units");
  await q.removeColumn("users", "ent_perms");
  await q.removeColumn("users", "ent_access");
};
