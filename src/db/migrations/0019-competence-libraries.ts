import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Competence master data libraries — the ISCED education ladder, the hard/soft
 * skill library, and the training catalogue. SP-owned reference data that role
 * competence profiles and assessments (later slices) build on.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("competence_education", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    level: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    label: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("competence_skills", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "hard" },
    description: { type: DataTypes.TEXT, allowNull: true },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_skills", ["type"]);

  await q.createTable("competence_training", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: "SP" },
    description: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_training", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("competence_training");
  await q.dropTable("competence_skills");
  await q.dropTable("competence_education");
};
