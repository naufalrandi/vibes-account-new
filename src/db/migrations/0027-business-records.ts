import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Business Unit registers (Enterprise ERP, Datana, Motoran). A generic
 * area+module-discriminated record table backing the platform shell's business
 * modules; module-specific fields live in the `data` JSONB blob.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("business_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    area: { type: DataTypes.ENUM("enterprise", "datana", "motoran"), allowNull: false },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("business_records", ["org_id", "area", "module"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("business_records");
};
