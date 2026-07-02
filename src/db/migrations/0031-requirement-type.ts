import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Framework requirements gain the OD Header/Assessable distinction plus an
 * optional short label. "Header" requirements group assessable ones; only
 * assessable requirements carry criteria and drive maturity scoring.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("framework_requirements", "type", {
    type: DataTypes.STRING, allowNull: false, defaultValue: "Assessable",
  });
  await q.addColumn("framework_requirements", "short_label", {
    type: DataTypes.STRING, allowNull: true,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("framework_requirements", "short_label");
  await q.removeColumn("framework_requirements", "type");
};
