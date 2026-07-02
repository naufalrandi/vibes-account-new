import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * FWRC — Framework Requirement Criteria join. Links a conformance response to a
 * requirement with a maturity statement (OD's fwrcView), spanning
 * framework/requirement/element/question/response. SP-global library entity.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("fwrc", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false },
    framework_id: { type: DataTypes.UUID, allowNull: false, references: { model: "frameworks", key: "id" }, onDelete: "CASCADE" },
    requirement_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_requirements", key: "id" }, onDelete: "CASCADE" },
    element_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_elements", key: "id" }, onDelete: "CASCADE" },
    question_id: { type: DataTypes.UUID, allowNull: true, references: { model: "conformance_questions", key: "id" }, onDelete: "SET NULL" },
    response_id: { type: DataTypes.UUID, allowNull: false, references: { model: "conformance_responses", key: "id" }, onDelete: "CASCADE" },
    statement: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("fwrc", ["requirement_id"]);
  await q.addIndex("fwrc", ["element_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("fwrc");
};
