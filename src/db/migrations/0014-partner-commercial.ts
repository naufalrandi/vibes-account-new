import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 3 (Commercial) — partner lifecycle metadata on Distributor organizations.
 * Additive and nullable/defaulted so existing rows stay valid. `partner_status`
 * and `partner_tier` are STRING (mutable AXIA labels) to avoid Postgres enum
 * migrations. `partner_code` is a unique `PRT-####` business key; `partner_audit`
 * is a JSONB timeline `[{ ts, msg }]`.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "partner_status", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "partner_tier", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "partner_code", { type: DataTypes.STRING, allowNull: true, unique: true });
  await q.addColumn("organizations", "partner_audit", { type: DataTypes.JSONB, allowNull: true, defaultValue: [] });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("organizations", "partner_audit");
  await q.removeColumn("organizations", "partner_code");
  await q.removeColumn("organizations", "partner_tier");
  await q.removeColumn("organizations", "partner_status");
};
