import type { Migration } from "../migrate";

/**
 * `controls` and `customer-focus` were invented by this port; OD has no such
 * modules (no `tn-m-controls` / `tn-m-customer-focus` anywhere in app.html,
 * verified 2026-08-23 @ b737152 — see Wave P task P-1.4). Both are being
 * removed from the registry (`registry.ts`) and the frontend
 * (`lib/nav/navConfig.ts`, `lib/api/types.ts`, `lib/implementation/config.ts`)
 * in the same wave.
 *
 * Data-safety gate (2026-08-23): a read-only count against
 * `implementation_records` returned ZERO rows for either module (51 rows in
 * the table total, none under these two keys), so this delete is a no-op on
 * content — kept as a real migration only to close the door on any future
 * row landing under a module key the application no longer recognizes.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    "DELETE FROM implementation_records WHERE module IN ('controls', 'customer-focus')",
  );
};

/** Irreversible by design — the deleted rows (if any had existed) had no OD-defined shape to restore. */
export const down: Migration = async () => {
  /* no-op */
};
