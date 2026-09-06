import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * R289 — ISRA carries its own tenant-scoped band scheme (OD `t.israRiskLevels`,
 * js/core.js:13573), editable between 2 and 6 levels. The port hardcoded OD's
 * five-band fallback with no editor, so a tenant could not band its own risk.
 * Null keeps the fallback.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_org_settings", "risk_levels", { type: DataTypes.JSONB, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_org_settings", "risk_levels");
};
