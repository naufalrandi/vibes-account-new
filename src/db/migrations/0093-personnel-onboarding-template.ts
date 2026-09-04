import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD `ONBOARD_TEMPLATE` (js/modules.js) seeds a new hire's onboarding
 * checklist from a 14-task template, and each task carries two attributes the
 * table had nowhere to put: the `group` it belongs to (Documentation /
 * Accounts & Access / Equipment / Orientation / Role & Competence), which is
 * how OD sections the checklist, and whether it is `required`, which is how
 * OD distinguishes a blocking task from an optional one.
 *
 * Existing rows predate the template and belong to no section, so `group`
 * defaults to '' (rendered as an ungrouped run) rather than being forced into
 * one of the five. `required` defaults to false for the same reason — an
 * ad-hoc task added by hand through `addOnboardingItem` is optional in OD too.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("personnel_onboarding_items", "group", { type: DataTypes.STRING, allowNull: false, defaultValue: "" });
  await q.addColumn("personnel_onboarding_items", "required", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("personnel_onboarding_items", "group");
  await q.removeColumn("personnel_onboarding_items", "required");
};
