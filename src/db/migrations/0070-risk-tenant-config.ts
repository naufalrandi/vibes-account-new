import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Migration 0070: Tenant Risk Register Configuration (Wave H-R1).
 * Adds riskMethod, riskLevels, riskAppetite, riskAppetiteVer to organizations.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "risk_method", {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: "basic",
  });
  await q.addColumn("organizations", "risk_levels", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: { names: ["Low", "Medium", "High", "Critical"], bounds: [4, 9, 15] },
  });
  await q.addColumn("organizations", "risk_appetite", {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 9,
  });
  await q.addColumn("organizations", "risk_appetite_ver", {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("organizations", "risk_appetite_ver");
  await q.removeColumn("organizations", "risk_appetite");
  await q.removeColumn("organizations", "risk_levels");
  await q.removeColumn("organizations", "risk_method");
};
