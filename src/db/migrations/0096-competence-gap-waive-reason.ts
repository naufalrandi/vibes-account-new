import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD's competence-gap vocabulary has five states, not three. `gapStatusBadge`
 * (js/modules.js:968) styles `Resolved`, `Planned`, `Reviewed` and `Waived`
 * and falls through to `Open`, which it labels "Raised"; the demo seed
 * (js/modules.js:350-351) persists both of the two this port was missing —
 * one gap at `Reviewed` with `reviewedBy`/`reviewedDate`, and one at `Waived`
 * carrying a `waiveReason`.
 *
 * `reviewed_by`/`reviewed_date` already exist. `waive_reason` does not, so a
 * gap could not be waived without losing the justification for waiving it.
 * Nullable with no default: only a waived gap carries one.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("competence_gaps", "waive_reason", { type: DataTypes.TEXT, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("competence_gaps", "waive_reason");
};
