import type { Migration } from "../migrate";

/**
 * Realigns `implementation_records.code` for the `design` module with OD 1:1
 * — the register's code prefix drifted to "DSG" during the initial port; OD
 * `dndSave` mints "DND-" codes (`ipPad(db.designItems,'DND-')`, app.html:
 * 22199). registry.ts now declares `design: { prefix: "DND", ... }`; this
 * rewrites any EXISTING rows still under the old "DSG-" prefix so the
 * register reads consistently (no row left stuck under the old prefix while
 * every new sibling gets the new one) — the same pattern migration 0053 used
 * for `parties`/`work-units`/`risks`/`concerns`/`nonconformities`/`reviews`/
 * `training`/`awareness`.
 *
 * No cross-reference rewrite is needed: unlike concerns/nonconformities/
 * awareness-campaigns (0053), nothing elsewhere in `implementation_records`
 * stores a design item's code in a JSONB field — the design catalog has no
 * routing/follow-up cross-references to another register.
 *
 * Idempotent: only rows still under the OLD "DSG-" prefix match, so a full
 * re-run touches zero rows once complete. `down` reverses the swap exactly
 * (lossless — the numeric suffix is never touched, only the prefix).
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "code" = regexp_replace("code", '^DSG-', 'DND-')
     WHERE "module" = 'design' AND "code" ~ '^DSG-\\d+$'`,
  );
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "code" = regexp_replace("code", '^DND-', 'DSG-')
     WHERE "module" = 'design' AND "code" ~ '^DND-\\d+$'`,
  );
};
