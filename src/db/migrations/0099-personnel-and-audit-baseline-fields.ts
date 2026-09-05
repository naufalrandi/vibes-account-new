import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Baseline-conformance field gaps across the personnel, work-unit,
 * performance-evaluation, internal-audit and DoA registers. All additive.
 *
 *  1. `leave_records.status` — the personnel-profile leave row is
 *     `{type, from, to, days, status}` in OD (`personAddLeave`,
 *     js/modules.js:5524) with a Pending/Approved/Rejected picklist; the table
 *     had nowhere to record the approval outcome. Defaults to 'Pending',
 *     which is what OD's list card falls back to for a row with no status
 *     (js/modules.js:4926) — so existing rows read exactly as OD would render
 *     them.
 *
 *  2. `resume_records.level` — OD education rows carry a `level`
 *     ('Master' / 'Bachelor' / 'Bachelor (ongoing)', js/modules.js:1078, 1085,
 *     1095) rendered as the first column of the Education card. Free text in
 *     OD (`<input id="ed-level">`, js/modules.js:5520), so a plain STRING, and
 *     nullable because non-education resume rows (experience / training /
 *     certifications) have no level.
 *
 *  3. `performance_records.reviewer` — OD stores the reviewer as free text
 *     (`<input id="pf-rev">`, js/modules.js:5526) and its own seed uses
 *     `reviewer:'Board'` (js/modules.js:1080), which is a governing body, not
 *     a user. The existing `reviewer_id` FK cannot hold that. Added ALONGSIDE
 *     `reviewer_id` rather than replacing it: dropping a live FK column would
 *     discard the structured links already stored, and OD's free-text field is
 *     a superset, not a rename.
 *
 *  4. `post_date` on `work_units` and the five internal-audit registers —
 *     every one of these OD records carries `postDate` between `createdAt` and
 *     `updatedAt` (work units js/core.js:11295 & 11443; iaPrograms
 *     js/core.js:18478; iaPlans 18479; iaSessions 18505; iaFindings 18506;
 *     iaReports 18491). It is the date the record was posted to the register,
 *     which OD lets a user set independently of the row's creation timestamp.
 *     Backfilled from `created_at` so existing rows keep their real date
 *     instead of being stamped with the migration's clock.
 *
 *  5. `perf_evals.objectives` — OD freezes the objectives register into the
 *     evaluation snapshot next to the indicators (`perfRecord`,
 *     js/core.js:8042-8043; `perfSeedBaseline`, js/core.js:7949-7950) and
 *     renders it as the "Objectives at evaluation (§6.2)" table
 *     (js/core.js:8031). Empty array default — existing snapshots froze no
 *     objectives and inventing them would be fabricating audit evidence.
 *
 *  6. `enum_doa_matrix_entries_approver_kind` gains 'auto' — OD's third
 *     approver kind, where the band resolves to the requester's next senior
 *     manager at approval time rather than to a fixed role or person
 *     (`doaResolveApprover`, js/modules.js:4323; rendered "escalation ↑" /
 *     "auto-escalated ↑" at js/modules.js:4350 and 3370). This one IS a
 *     Postgres ENUM (created by 0085), so it needs `ALTER TYPE ... ADD VALUE`
 *     — same pattern as 0052 / 0086. Umzug runs each migration without an
 *     enclosing transaction (see `createMigrator` in ../migrate.ts), so the
 *     pre-PG-12 "cannot run inside a transaction block" restriction does not
 *     bite here.
 */

const POST_DATE_TABLES = ["work_units", "ia_programs", "ia_plans", "ia_sessions", "ia_findings", "ia_reports"];

/**
 * This migration is not wrapped in a transaction (see the note above), so a run
 * that fails partway leaves the columns it already added in place — and the
 * retry then dies on `check_for_column_name_collision` before reaching the rest,
 * which is exactly what happened on the deploy target. Every add is therefore
 * guarded: adding an existing column is a no-op rather than a hard failure.
 */
async function addColumnIfMissing(
  q: Parameters<Migration>[0]["context"],
  table: string,
  column: string,
  spec: Parameters<typeof q.addColumn>[2],
): Promise<boolean> {
  const [rows] = await q.sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`,
  );
  if ((rows as unknown[]).length > 0) return false;
  await q.addColumn(table, column, spec);
  return true;
}

export const up: Migration = async ({ context: q }) => {
  await addColumnIfMissing(q, "leave_records", "status", { type: DataTypes.STRING, allowNull: false, defaultValue: "Pending" });
  await addColumnIfMissing(q, "resume_records", "level", { type: DataTypes.STRING, allowNull: true });
  await addColumnIfMissing(q, "performance_records", "reviewer", { type: DataTypes.STRING, allowNull: true });
  await addColumnIfMissing(q, "perf_evals", "objectives", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  // `defaultValue: DataTypes.NOW` is a Sequelize-side default, not a SQL one, so
  // this rendered as `ADD COLUMN "post_date" TIMESTAMPTZ NOT NULL` — which
  // Postgres rejects outright on a table that already has rows. That is what
  // failed the original run. Add nullable, backfill from created_at, then
  // tighten, so the column ends up exactly as the model declares it.
  for (const table of POST_DATE_TABLES) {
    const added = await addColumnIfMissing(q, table, "post_date", { type: DataTypes.DATE, allowNull: true });
    if (added) {
      await q.sequelize.query(`UPDATE "${table}" SET "post_date" = COALESCE("created_at", NOW()) WHERE "post_date" IS NULL`);
      await q.sequelize.query(`ALTER TABLE "${table}" ALTER COLUMN "post_date" SET DEFAULT NOW()`);
      await q.sequelize.query(`ALTER TABLE "${table}" ALTER COLUMN "post_date" SET NOT NULL`);
    }
  }

  await q.sequelize.query(`ALTER TYPE "enum_doa_matrix_entries_approver_kind" ADD VALUE IF NOT EXISTS 'auto'`);
};

export const down: Migration = async ({ context: q }) => {
  for (const table of POST_DATE_TABLES) {
    await q.removeColumn(table, "post_date");
  }
  await q.removeColumn("perf_evals", "objectives");
  await q.removeColumn("performance_records", "reviewer");
  await q.removeColumn("resume_records", "level");
  await q.removeColumn("leave_records", "status");
  // Postgres cannot drop a single enum value in place; leaving 'auto' is
  // harmless (no rows are forced onto it) — same as 0052.
};
