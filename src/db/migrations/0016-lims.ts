import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 10 — LIMS (laboratory, ISO 17025 line). Testing services are defined on
 * a shared configurable workflow engine: 10 fixed base stages plus 5 configurable
 * stages (Sampling Planning, Sampling, Certificate Issuance, Sample Retention,
 * Sample Disposal), each set per service to Mandatory / Optional / Not Applicable.
 * The per-service stage states live in the `stages` JSONB column; the workflow
 * preview is generated on the fly (see `limsEngine.ts`).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("testing_services", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    stages: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("testing_services", ["org_id"]);
  await q.addConstraint("testing_services", { fields: ["org_id", "code"], type: "unique", name: "testing_service_org_code_unique" });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("testing_services");
};
