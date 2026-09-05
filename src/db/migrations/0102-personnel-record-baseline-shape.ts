import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Three personnel sub-record shapes that could not hold what OD stores.
 *
 * 1. `disciplinary_records.severity` — OD `personAddDisc` (js/modules.js:5525)
 *    writes `{date, type, severity, action, note}` with a Low/Medium/High
 *    select, and `modules.js:4929` renders severity as its own 90px tag column.
 *    The table had no such column, so that column could never be populated.
 *
 * 2. `resume_records.provider` — OD `personAddTraining` (js/modules.js:5522)
 *    writes `{name, provider, year}`. There was no home for `provider`.
 *
 * 3. `resume_records` dates as DATEONLY — OD stores plain strings here, and
 *    three of its own seeded values are not dates at all: education `year` is
 *    '2006' (modules.js:1078), experience `to` is 'Present' (modules.js:1112),
 *    and certification `expiry` defaults to the em-dash '—' (modules.js:5523,
 *    `pGet('ce-exp')||'—'`). A DATEONLY column rejects all three, so the
 *    baseline's own resume rows were unrepresentable. Widened to STRING, which
 *    is what OD's shape actually is.
 */
const DATE_COLS = ["start_date", "end_date", "expiry_date"];

export const up: Migration = async ({ context: q }) => {
  await q.addColumn("disciplinary_records", "severity", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("resume_records", "provider", { type: DataTypes.STRING, allowNull: true });
  for (const c of DATE_COLS) {
    await q.sequelize.query(
      `ALTER TABLE "resume_records" ALTER COLUMN "${c}" TYPE VARCHAR(255) USING "${c}"::text`,
    );
  }
};

export const down: Migration = async ({ context: q }) => {
  for (const c of DATE_COLS) {
    // Lossy: any non-date string OD legitimately stores ('2006', 'Present', '—')
    // cannot cast back, so those rows lose the value rather than block the down.
    await q.sequelize.query(
      `ALTER TABLE "resume_records" ALTER COLUMN "${c}" TYPE DATE USING NULLIF(regexp_replace("${c}", '^(\\d{4}-\\d{2}-\\d{2}).*$', '\\1'), "${c}")::date`,
    );
  }
  await q.removeColumn("resume_records", "provider");
  await q.removeColumn("disciplinary_records", "severity");
};
