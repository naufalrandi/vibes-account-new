import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * R334 — OD's `israLtPlatformUpdate` compares a tenant override's
 * `basePlatformVersion` against the platform master's `platformVersion` to
 * tell the tenant that the master moved on after they customized it. The
 * override column existed; the four platform library tables carried no
 * version at all, so the comparison could never fire and a tenant sitting on
 * a stale customization was never told.
 */
const TABLES = [
  "isra_primary_asset_library",
  "isra_secondary_asset_library",
  "isra_threat_library",
  "isra_vuln_library",
] as const;

export const up: Migration = async ({ context: q }) => {
  for (const table of TABLES) {
    await q.addColumn(table, "platform_version", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 });
  }
};

export const down: Migration = async ({ context: q }) => {
  for (const table of TABLES) {
    await q.removeColumn(table, "platform_version");
  }
};
