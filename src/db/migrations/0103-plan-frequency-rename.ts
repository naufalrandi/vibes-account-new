import type { Migration } from "../migrate";

/**
 * OD names this field `frequency`, not `billingFrequency`: `seedPlans`
 * (js/core.js:21595-21597) writes `frequency:'Monthly'` / `'Annual'` on all
 * three seeded plans, and `planModal` (js/core.js:21758) reads and writes the
 * same key. The port renamed it on the way in.
 */
export const up: Migration = async ({ context: q }) => {
  await q.renameColumn("plans", "billing_frequency", "frequency");
};

export const down: Migration = async ({ context: q }) => {
  await q.renameColumn("plans", "frequency", "billing_frequency");
};
