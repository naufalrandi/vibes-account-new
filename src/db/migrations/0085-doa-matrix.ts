import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-58 §3 — Delegation-of-Authority spend-band matrix (OD `db.doaMatrix`,
 * 22 seeded records). Distinct from `ApprovalScheme.gates` (pure workflow-gate
 * sequencing, zero field overlap) — the previous `ALIAS` mapping to
 * ApprovalScheme was a false positive, fixed alongside this migration.
 * `max` is nullable: one sampled design record had `max: ""`, read as "no
 * spend ceiling" for that type/approver combination.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("doa_matrix_entries", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    type: { type: DataTypes.STRING, allowNull: false },
    max: { type: DataTypes.DECIMAL, allowNull: true },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    approver: { type: DataTypes.STRING, allowNull: false },
    approver_kind: { type: DataTypes.ENUM("role", "user"), allowNull: false },
    finance: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    quotes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("doa_matrix_entries", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("doa_matrix_entries");
};
