import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * The many-to-many link between a framework element and a requirement. Unique
 * per (element, requirement); both FKs cascade so removing either side clears
 * the link.
 */
export class ElementRequirementMap extends Model<
  InferAttributes<ElementRequirementMap>,
  InferCreationAttributes<ElementRequirementMap>
> {
  declare id: CreationOptional<string>;
  declare elementId: string;
  declare requirementId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ElementRequirementMap.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    elementId: { type: DataTypes.UUID, allowNull: false, field: "element_id" },
    requirementId: { type: DataTypes.UUID, allowNull: false, field: "requirement_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "framework_element_requirement_maps",
    underscored: true,
    indexes: [{ unique: true, fields: ["element_id", "requirement_id"], name: "framework_el_req_map_unique" }],
  },
);
