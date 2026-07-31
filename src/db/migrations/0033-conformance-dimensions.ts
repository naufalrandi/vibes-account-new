import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD's Conformance Questions split into Coverage/Maturity dimensions (grouped by
 * category on the element detail page) and a "child" response that reveals a
 * framework picker (OD `respModal`/`fwe-assess`). Question/response `code` mirror
 * the OD's `code-pill` display (e.g. "CQ-001", "R1").
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("conformance_questions", "dimension", {
    type: DataTypes.ENUM("Coverage", "Maturity"), allowNull: false, defaultValue: "Maturity",
  });
  await q.addColumn("conformance_questions", "category", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("conformance_questions", "code", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("conformance_questions", "title", { type: DataTypes.TEXT, allowNull: true });

  await q.addColumn("conformance_responses", "code", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("conformance_responses", "child", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("conformance_responses", "child");
  await q.removeColumn("conformance_responses", "code");
  await q.removeColumn("conformance_questions", "title");
  await q.removeColumn("conformance_questions", "code");
  await q.removeColumn("conformance_questions", "category");
  await q.removeColumn("conformance_questions", "dimension");
};
