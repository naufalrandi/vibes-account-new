import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * OD `PERSON_EMP_STATUS` (js/modules.js). Probation is deliberately absent —
 * OD carries probation as a period inside the contract (`contract.probationEnd`,
 * js/modules.js:4657/4712), not as an employment status and not as a contract
 * type.
 */
export const EMPLOYMENT_STATUSES = [
  "Onboarding", "Active", "On Leave", "Suspended", "Offboarding", "Exited", "Alumni",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
/**
 * OD `CONTRACT_TYPE_SEED` (js/modules.js:5040-5044) names exactly four contract
 * types — "Permanent", "Fixed Duration", "Internship", "Contractor (SOW)"
 * (ids ct-perm/ct-fixed/ct-intern/ct-sow) — paired with the `PERSON_TYPES`
 * vocabulary at js/modules.js:1019.
 *
 * The three port-only members ("Fixed-Term", "Probation", "Outsourced") appear
 * nowhere in OD as contract types and are dropped by migration 0117.
 *
 * OD itself stores a reference, `h.contract.typeId` (js/modules.js:1043, picker
 * at :5027), into the `ent-ctypes` register — the same register
 * `personnelContractComp.models.ts` already points at. This column stays a name
 * enum because moving it to that id is an API shape change that has to land
 * with the frontend; the names here now match the register's rows
 * (src/db/seeders/data/businessRecords/contractTypes.json).
 */
export const CONTRACT_TYPES = [
  "Permanent", "Fixed Duration", "Internship", "Contractor (SOW)",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/**
 * Personal / emergency-contact / employment-contract sub-record for a `User`
 * (OD `ent-personnel` — Personal, Emergency, Employment tabs). 1:1 with User.
 */
export class PersonnelProfile extends Model<
  InferAttributes<PersonnelProfile>,
  InferCreationAttributes<PersonnelProfile>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  // Personal
  declare dateOfBirth: string | null;
  declare gender: string | null;
  declare maritalStatus: string | null;
  declare nationality: string | null;
  declare idNumber: string | null;
  declare religion: string | null;
  declare bloodType: string | null;
  declare address: string | null;
  declare country: string | null;
  declare state: string | null;
  declare city: string | null;
  declare postalCode: string | null;
  // Emergency contact
  declare emergencyContactName: string | null;
  declare emergencyContactPhone: string | null;
  declare emergencyContactRelationship: string | null;
  // Employment/contract
  declare employeeId: string | null;
  declare employmentStatus: EmploymentStatus | null;
  declare managerId: string | null;
  declare contractType: ContractType | null;
  declare contractStartDate: string | null;
  declare contractEndDate: string | null;
  declare probationEndDate: string | null;
  declare contractDocumentRef: string | null;
  declare contractSigned: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PersonnelProfile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "user_id" },
    dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true, field: "date_of_birth" },
    gender: { type: DataTypes.STRING, allowNull: true },
    maritalStatus: { type: DataTypes.STRING, allowNull: true, field: "marital_status" },
    nationality: { type: DataTypes.STRING, allowNull: true },
    idNumber: { type: DataTypes.STRING, allowNull: true, field: "id_number" },
    religion: { type: DataTypes.STRING, allowNull: true },
    bloodType: { type: DataTypes.STRING, allowNull: true, field: "blood_type" },
    address: { type: DataTypes.TEXT, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    postalCode: { type: DataTypes.STRING, allowNull: true, field: "postal_code" },
    emergencyContactName: { type: DataTypes.STRING, allowNull: true, field: "emergency_contact_name" },
    emergencyContactPhone: { type: DataTypes.STRING, allowNull: true, field: "emergency_contact_phone" },
    emergencyContactRelationship: { type: DataTypes.STRING, allowNull: true, field: "emergency_contact_relationship" },
    employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" },
    employmentStatus: {
      type: DataTypes.ENUM(...EMPLOYMENT_STATUSES),
      allowNull: true,
      field: "employment_status",
    },
    managerId: { type: DataTypes.UUID, allowNull: true, field: "manager_id" },
    contractType: {
      type: DataTypes.ENUM(...CONTRACT_TYPES),
      allowNull: true,
      field: "contract_type",
    },
    contractStartDate: { type: DataTypes.DATEONLY, allowNull: true, field: "contract_start_date" },
    contractEndDate: { type: DataTypes.DATEONLY, allowNull: true, field: "contract_end_date" },
    probationEndDate: { type: DataTypes.DATEONLY, allowNull: true, field: "probation_end_date" },
    contractDocumentRef: { type: DataTypes.STRING, allowNull: true, field: "contract_document_ref" },
    contractSigned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "contract_signed" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "personnel_profiles", underscored: true },
);
