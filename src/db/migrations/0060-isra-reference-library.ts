import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group A part 1 — global reference data, no `org_id`,
 * seeded once at deploy: the 93-row Annex A master, the Threat/Vuln libraries,
 * and the Group→Subgroup taxonomy for Primary/Secondary assets.
 *
 * These "library" tables deliberately deviate from this file group's usual
 * `id: UUID` PK convention: their primary key IS the OD business-key string
 * (`THR-…`, `VUL-…`, `PAG-…`, `PASG-…`, `SSG-…`) because that exact string is
 * what every downstream org-scoped table (asset maps, scenarios, knowledge
 * maps) references, per `docs/isra-schema-design.md` §2.3/§2.10.
 *
 * See `docs/isra-schema-design.md` §2.3 for the full column rationale.
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_annex_a_controls", {
    ref: { type: DataTypes.STRING, primaryKey: true },
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

  await q.createTable("isra_threat_library", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    ...ts,
  });

  await q.createTable("isra_vuln_library", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    ...ts,
  });

  await q.createTable("isra_pa_groups", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });

  await q.createTable("isra_pa_subgroups", {
    id: { type: DataTypes.STRING, primaryKey: true },
    group_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_pa_groups", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    examples: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_pa_subgroups", ["group_id"]);

  await q.createTable("isra_sa_groups", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });

  await q.createTable("isra_sa_subgroups", {
    id: { type: DataTypes.STRING, primaryKey: true },
    group_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_sa_groups", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    examples: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Gates V2 baseline auto-load (`israSaSubApproved`) — see design doc §1.2.
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    ...ts,
  });
  await q.addIndex("isra_sa_subgroups", ["group_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_sa_subgroups");
  await q.dropTable("isra_sa_groups");
  await q.dropTable("isra_pa_subgroups");
  await q.dropTable("isra_pa_groups");
  await q.dropTable("isra_vuln_library");
  await q.dropTable("isra_threat_library");
  await q.dropTable("isra_annex_a_controls");
};
