import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-265 — OD partitions `db.roles` by `tenantId === '__ENT_' + activeCompany
 * + '__'` (`__ENT__` for AXIA): every operating company sees and manages its
 * own Enterprise role-profile list, not one flat list shared by all of them.
 * Mirrors `business_records.company` (SOF-? Wave C) — same column name,
 * same `'axia'` default for existing/omitted rows.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("competence_roles", "company", { type: DataTypes.STRING, allowNull: false, defaultValue: "axia" });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("competence_roles", "company");
};
