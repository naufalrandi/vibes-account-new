import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Competence module governance settings — OD `compSettings` (index.html:13378):
 * `{requireMethod, allowActivateMissing, requireEvidenceMandatory, allowOverride,
 * defaultReassess}`.
 *
 * The competence records themselves (roles/profiles, skills, education,
 * assignments, assessments, gaps, instruments) already have dedicated tables, so
 * the only new storage is the per-org settings singleton — the exact
 * `document_settings` (0049) / `awareness_settings` (0050) pattern: one JSONB row
 * per organization so future toggles need no further migration.
 *
 * Deliberate deviation from OD: `defaultReassess` is stored as a NUMBER of
 * months (default `12`) rather than OD's `COMP_REVFREQ` string vocabulary
 * ('Annually' | 'Every 2 years' | 'Every 3 years' | 'Custom') — this is the exact
 * shape `competence.assessment.service.ts`'s `assessValidUntil` already expects
 * (`role.reviewFreq` is a numeric-months string, `|| 12` today), so the setting
 * wires straight into the existing computation instead of adding a second unit
 * system.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("competence_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false, unique: true,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("competence_settings");
};
