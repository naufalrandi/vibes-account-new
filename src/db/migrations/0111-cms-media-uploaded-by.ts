import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/** OD `db.cmsMedia[].uploadedBy` (js/core.js:3770) — the actor who uploaded the
 *  asset. Neither repo had a home for it. */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("cms_media", "uploaded_by", { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("cms_media", "uploaded_by");
};
