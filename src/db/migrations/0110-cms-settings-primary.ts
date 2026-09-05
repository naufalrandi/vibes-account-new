import type { Migration } from "../migrate";

/**
 * OD names the brand colour `primary` (`db.cmsSettings`, js/core.js:3755). Both
 * repos independently renamed it to `primaryColor` — they agreed with each
 * other and diverged from the design together, which is why nothing caught it.
 */
export const up: Migration = async ({ context: q }) => {
  await q.renameColumn("cms_settings", "primary_color", "primary");
};

export const down: Migration = async ({ context: q }) => {
  await q.renameColumn("cms_settings", "primary", "primary_color");
};
