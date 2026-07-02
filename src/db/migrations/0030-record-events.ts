import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Per-record events (activity timeline + comments) attached to any register
 * record by (module, record_id). Polymorphic — record_id is a loose reference so
 * both implementation and business records can carry a timeline.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("record_events", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    module: { type: DataTypes.STRING, allowNull: false },
    record_id: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.ENUM("activity", "comment"), allowNull: false },
    actor: { type: DataTypes.STRING, allowNull: true },
    text: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("record_events", ["org_id", "module", "record_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("record_events");
};
