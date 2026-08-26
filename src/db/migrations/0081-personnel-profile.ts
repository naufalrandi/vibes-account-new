import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Personnel record sub-data (OD `ent-personnel`): Personal, Emergency contact
 * and Employment/contract tabs (`personEditPersonal`/`personEditEmergency`/
 * `personEditEmployment`, `parity/frontend.md:1183-1188`). 1:1 with `users` —
 * kept as its own table rather than ~24 new columns on the already-large
 * `User` model.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("personnel_profiles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: {
      type: DataTypes.UUID, allowNull: false, unique: true,
      references: { model: "users", key: "id" }, onDelete: "CASCADE",
    },
    // Personal (personEditPersonal, ~12 fields)
    date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
    gender: { type: DataTypes.STRING, allowNull: true },
    marital_status: { type: DataTypes.STRING, allowNull: true },
    nationality: { type: DataTypes.STRING, allowNull: true },
    id_number: { type: DataTypes.STRING, allowNull: true },
    religion: { type: DataTypes.STRING, allowNull: true },
    blood_type: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    postal_code: { type: DataTypes.STRING, allowNull: true },
    // Emergency contact (personEditEmergency, 3 fields)
    emergency_contact_name: { type: DataTypes.STRING, allowNull: true },
    emergency_contact_phone: { type: DataTypes.STRING, allowNull: true },
    emergency_contact_relationship: { type: DataTypes.STRING, allowNull: true },
    // Employment/contract (personEditEmployment, 12 fields — personnelType/
    // siteId/orgUnitId already live on `users` and are reused, not duplicated)
    employee_id: { type: DataTypes.STRING, allowNull: true },
    employment_status: { type: DataTypes.ENUM("Probation", "Active", "Contract Ended", "Terminated"), allowNull: true },
    manager_id: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" },
    contract_type: { type: DataTypes.ENUM("Permanent", "Fixed-Term", "Probation", "Internship", "Outsourced"), allowNull: true },
    contract_start_date: { type: DataTypes.DATEONLY, allowNull: true },
    contract_end_date: { type: DataTypes.DATEONLY, allowNull: true },
    probation_end_date: { type: DataTypes.DATEONLY, allowNull: true },
    contract_document_ref: { type: DataTypes.STRING, allowNull: true },
    contract_signed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("personnel_profiles", ["manager_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("personnel_profiles");
};
