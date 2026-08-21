import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group C — org-level control customization + clause
 * maturity baselines (design doc §2.5). `isra_org_controls` deliberately
 * holds only rows an org actually customized/added (not a full 93-row clone
 * per org, unlike OD's in-memory shortcut) — effective control resolution
 * (org row if present, else `isra_annex_a_controls`) is service-layer logic
 * for a later batch.
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_org_controls", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    ref: { type: DataTypes.STRING, allowNull: false },
    custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    csf: { type: DataTypes.STRING, allowNull: true },
    type: { type: DataTypes.STRING, allowNull: true },
    fn_p: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fn_d: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fn_c: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ded_l: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ded_c: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_org_controls", ["org_id"]);
  await q.addIndex("isra_org_controls", ["org_id", "ref"], { unique: true });

  await q.createTable("isra_control_maturity_baselines", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    gov: { type: DataTypes.INTEGER, allowNull: true },
    doc: { type: DataTypes.INTEGER, allowNull: true },
    impl: { type: DataTypes.INTEGER, allowNull: true },
    mon: { type: DataTypes.INTEGER, allowNull: true },
    comp: { type: DataTypes.INTEGER, allowNull: true },
    set_by: { type: DataTypes.STRING, allowNull: true },
    set_at: { type: DataTypes.DATE, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_control_maturity_baselines", ["org_id"]);
  await q.addIndex("isra_control_maturity_baselines", ["org_id", "annex_ref"], { unique: true });

  // Per-tenant suppress/add overlay on the platform Vuln→Annex A map
  // (design doc §1.3 — base + tenant-overlay, not a legacy/live pair).
  await q.createTable("isra_vuln_control_overlay", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    kind: { type: DataTypes.STRING, allowNull: false },
    edge_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_km_vuln_control", key: "id" }, onDelete: "CASCADE" },
    vuln_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
    annex_ref: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    role: { type: DataTypes.STRING, allowNull: true },
    affects: { type: DataTypes.STRING, allowNull: true },
    strength: { type: DataTypes.STRING, allowNull: true },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    created_by: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_vuln_control_overlay", ["org_id"]);
  await q.addIndex("isra_vuln_control_overlay", ["vuln_id"]);
  await q.addIndex("isra_vuln_control_overlay", ["annex_ref"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_vuln_control_overlay");
  await q.dropTable("isra_control_maturity_baselines");
  await q.dropTable("isra_org_controls");
};
