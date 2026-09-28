import type { Migration } from "../migrate";

/**
 * The seeders no longer label their sample data "demo" (see 0125 for the
 * removed Demo Access feature). This rewrites the same exact literals in rows
 * earlier seeds already wrote, in place — no row is inserted or deleted, and
 * only rows that contain the literal are touched.
 *
 * Each entry is (table, column, pairs). Pairs run in order, so the longer
 * " (demo seed)" is replaced before its " (demo)" prefix.
 */
type Pair = readonly [from: string, to: string];

const DEMO_SUFFIXES: Pair[] = [
  [" (demo seed)", ""],
  [" (demo)", ""],
];

const TEXT_COLUMNS: { table: string; column: string; pairs: Pair[] }[] = [
  { table: "users", column: "email", pairs: [["@axia-demo.local", "@axia-sample.local"]] },
  { table: "isra_control_maturity_baselines", column: "set_by", pairs: [["System (demo)", "System"]] },
  { table: "isra_audit", column: "event", pairs: DEMO_SUFFIXES },
  { table: "business_processes", column: "name", pairs: [["Demo Preparation", "Presentation Preparation"]] },
  { table: "implementation_records", column: "title", pairs: [["Demo Preparation", "Presentation Preparation"]] },
  { table: "role_assignments", column: "mod_reason", pairs: [["demo audit findings", "internal audit findings"]] },
  {
    table: "cms_pages",
    column: "body",
    pairs: [["Request a demo or talk to sales.", "Book a consultation or talk to sales."]],
  },
];

const JSONB_COLUMNS: { table: string; column: string; pairs: Pair[] }[] = [
  { table: "role_assignments", column: "responsibilities", pairs: [["demo audit findings", "internal audit findings"]] },
  {
    table: "isra_scenarios",
    column: "activity",
    pairs: [...DEMO_SUFFIXES, ["2-cycle demo", "2-cycle example"], ["System (demo)", "System"]],
  },
];

/** A literal as it appears inside a JSON string (quotes/backslashes/control chars escaped). */
const jsonEscaped = (s: string) => JSON.stringify(s).slice(1, -1);

export const up: Migration = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    for (const { table, column, pairs } of TEXT_COLUMNS) {
      for (const [from, to] of pairs) {
        await q.sequelize.query(
          `UPDATE "${table}" SET "${column}" = replace("${column}", :from, :to) WHERE strpos("${column}", :from) > 0`,
          { replacements: { from, to }, transaction },
        );
      }
    }
    for (const { table, column, pairs } of JSONB_COLUMNS) {
      for (const [from, to] of pairs) {
        await q.sequelize.query(
          `UPDATE "${table}" SET "${column}" = replace("${column}"::text, :from, :to)::jsonb WHERE strpos("${column}"::text, :from) > 0`,
          { replacements: { from: jsonEscaped(from), to: jsonEscaped(to) }, transaction },
        );
      }
    }
  });
};

/**
 * No-op by design: the old wording is exactly what this removes, and the
 * suffix deletions (" (demo)") are not reversible without guessing which
 * rows carried them.
 */
export const down: Migration = async () => {
  /* no-op */
};
