import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Interested Parties (ISO 4.2) — parties + their requirements sub-register.
 * Requirements can be raised as risks (into the risks register) and linked to
 * compliance obligations (obligation codes stored on the requirement).
 */
const ENVELOPE = {
  created_by: { type: DataTypes.STRING, allowNull: true },
  last_updated_by: { type: DataTypes.STRING, allowNull: true },
  activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

export const up: Migration = async ({ context: q }) => {
  await q.createTable("ip_parties", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    ...ENVELOPE,
  });
  await q.addIndex("ip_parties", ["org_id"]);

  await q.createTable("ip_requirements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    party_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ip_parties", key: "id" }, onDelete: "CASCADE" },
    topic: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Requirement" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    related_co: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    linked_obligations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    raised_as_risk: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    dismiss_justification: { type: DataTypes.TEXT, allowNull: true },
    hold_justification: { type: DataTypes.TEXT, allowNull: true },
    archive_justification: { type: DataTypes.TEXT, allowNull: true },
    decided_by: { type: DataTypes.STRING, allowNull: true },
    decided_at: { type: DataTypes.STRING, allowNull: true },
    archived_by: { type: DataTypes.STRING, allowNull: true },
    archived_at: { type: DataTypes.STRING, allowNull: true },
    ...ENVELOPE,
  });
  await q.addIndex("ip_requirements", ["org_id"]);
  await q.addIndex("ip_requirements", ["party_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("ip_requirements");
  await q.dropTable("ip_parties");
};
