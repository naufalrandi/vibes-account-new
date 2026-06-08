import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 1 of the AXIA rebuild — the Framework & Assessment domain. Additive:
 * adds framework groups, requirements, elements, element↔requirement maps, and
 * the assessment engine (criteria, questions, responses, response→criterion
 * scoring) without disturbing the existing catalog tables. The framework-catalog
 * cutover (frameworks → groups) happens in a later step.
 */
export const up: Migration = async ({ context: q }) => {
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };
  const fwRef = (onDelete: "CASCADE" | "RESTRICT" = "CASCADE") => ({
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: "frameworks", key: "id" },
    onDelete,
  });

  await q.createTable("framework_groups", {
    id: uuid,
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    ...ts,
  });

  await q.createTable("framework_requirements", {
    id: uuid,
    framework_id: fwRef(),
    code: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });
  await q.addConstraint("framework_requirements", {
    fields: ["framework_id", "code"],
    type: "unique",
    name: "framework_requirements_framework_code_unique",
  });
  await q.addIndex("framework_requirements", ["framework_id"]);

  await q.createTable("framework_elements", {
    id: uuid,
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });

  await q.createTable("framework_element_requirement_maps", {
    id: uuid,
    element_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_elements", key: "id" },
      onDelete: "CASCADE",
    },
    requirement_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_requirements", key: "id" },
      onDelete: "CASCADE",
    },
    ...ts,
  });
  await q.addConstraint("framework_element_requirement_maps", {
    fields: ["element_id", "requirement_id"],
    type: "unique",
    name: "framework_el_req_map_unique",
  });

  await q.createTable("assessment_criteria", {
    id: uuid,
    requirement_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_requirements", key: "id" },
      onDelete: "CASCADE",
    },
    score: { type: DataTypes.INTEGER, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    ...ts,
  });
  await q.addConstraint("assessment_criteria", {
    fields: ["requirement_id", "score"],
    type: "unique",
    name: "assessment_criteria_req_score_unique",
  });

  await q.createTable("assessment_questions", {
    id: uuid,
    element_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_elements", key: "id" },
      onDelete: "CASCADE",
    },
    text: { type: DataTypes.TEXT, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });
  await q.addIndex("assessment_questions", ["element_id"]);

  await q.createTable("assessment_responses", {
    id: uuid,
    question_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "assessment_questions", key: "id" },
      onDelete: "CASCADE",
    },
    text: { type: DataTypes.TEXT, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });
  await q.addIndex("assessment_responses", ["question_id"]);

  await q.createTable("assessment_response_criteria", {
    id: uuid,
    response_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "assessment_responses", key: "id" },
      onDelete: "CASCADE",
    },
    criterion_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "assessment_criteria", key: "id" },
      onDelete: "CASCADE",
    },
    ...ts,
  });
  await q.addConstraint("assessment_response_criteria", {
    fields: ["response_id"],
    type: "unique",
    name: "assessment_response_criteria_response_unique",
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("assessment_response_criteria");
  await q.dropTable("assessment_responses");
  await q.dropTable("assessment_questions");
  await q.dropTable("assessment_criteria");
  await q.dropTable("framework_element_requirement_maps");
  await q.dropTable("framework_elements");
  await q.dropTable("framework_requirements");
  await q.dropTable("framework_groups");
};
