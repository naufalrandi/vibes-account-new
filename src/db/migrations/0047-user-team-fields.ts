import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD tenant team rows (`renderTenantTeam`, app.html:26306) carry three
 * per-member fields the `users` table never modelled:
 *
 * 1. `siteId` — the site the member belongs to (Site column, `wuSiteName`).
 * 2. `personnelType` — the canonical personnel category ("Employee (Permanent
 *    Contract)", "Contractor", …; `tmMigratePtypes`), shown in the Type column
 *    and in the Assign Business Processes hint (`tmBpForm`, 9126).
 * 3. `processes` — the business-process assignment behind the BP Count column
 *    and the `tmBpForm` multi-select. Stored as a JSONB array of the org's
 *    processes-register record ids (same shape as `work_units.process_ids`).
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "site_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "sites", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("users", "personnel_type", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "process_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "process_ids");
  await q.removeColumn("users", "personnel_type");
  await q.removeColumn("users", "site_id");
};
