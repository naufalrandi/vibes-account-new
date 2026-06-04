import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

export const up: Migration = async ({ context: q }) => {
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("framework_types", {
    id: uuid,
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });

  // Framework families belong to a framework type. Only the column needed to
  // enforce the "cannot delete a type with linked families" rule is created
  // here; the full families feature is out of scope for this milestone. RESTRICT
  // mirrors the business rule at the DB level as a backstop to the service check.
  await q.createTable("framework_families", {
    id: uuid,
    framework_type_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_types", key: "id" },
      onDelete: "RESTRICT",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });

  await q.addIndex("framework_types", ["sort_order"]);
  await q.addIndex("framework_families", ["framework_type_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("framework_families");
  await q.dropTable("framework_types");
};
