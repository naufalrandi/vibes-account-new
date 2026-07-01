import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 2 — Organization Profile parity. Adds the branding + system-defaults the
 * legacy `org-profile` Branding and System Defaults tabs persisted, plus the
 * `org_signatories` child table backing the Signatories tab (authorized
 * representatives for agreement signing — feeds the Phase 3 agreement SP block).
 *
 * `branding` and `system_defaults` are JSONB blobs (per decision R8's "store the
 * structured shape, not rendered output") so their inner fields can evolve
 * without a migration. `tax_id` joins the existing identity columns on
 * organizations. Signatories are org-scoped (FK → organizations, ON DELETE
 * CASCADE) with an `org_id` index backing the scoped list query.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "tax_id", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "branding", { type: DataTypes.JSONB, allowNull: true });
  await q.addColumn("organizations", "system_defaults", { type: DataTypes.JSONB, allowNull: true });

  await q.createTable("org_signatories", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    full_name: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    signature_image: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Active", "Inactive"),
      allowNull: false,
      defaultValue: "Active",
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("org_signatories", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("org_signatories");
  await q.removeColumn("organizations", "system_defaults");
  await q.removeColumn("organizations", "branding");
  await q.removeColumn("organizations", "tax_id");
};
