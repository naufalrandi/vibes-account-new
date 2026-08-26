import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Personnel sub-record logs (OD `ent-personnel` Resume/Leaves/Disciplinary/
 * Performance tabs) — see migration 0082 for the field-provenance note (field
 * names inferred from HR convention; only field counts were audited against
 * `modules.js`, which is unavailable in this environment).
 */

export const RESUME_RECORD_TYPES = ["Education", "Experience", "Training", "Certification"] as const;
export type ResumeRecordType = (typeof RESUME_RECORD_TYPES)[number];

export class ResumeRecord extends Model<InferAttributes<ResumeRecord>, InferCreationAttributes<ResumeRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare recordType: ResumeRecordType;
  declare title: string;
  declare organization: string | null;
  declare fieldOfStudy: string | null;
  declare location: string | null;
  declare startDate: string | null;
  declare endDate: string | null;
  declare isCurrent: CreationOptional<boolean>;
  declare grade: string | null;
  declare description: string | null;
  declare credentialId: string | null;
  declare issuer: string | null;
  declare certificateNumber: string | null;
  declare expiryDate: string | null;
  declare attachmentUrl: string | null;
  declare notes: string | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ResumeRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    recordType: { type: DataTypes.STRING, allowNull: false, field: "record_type" },
    title: { type: DataTypes.STRING, allowNull: false },
    organization: { type: DataTypes.STRING, allowNull: true },
    fieldOfStudy: { type: DataTypes.STRING, allowNull: true, field: "field_of_study" },
    location: { type: DataTypes.STRING, allowNull: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: true, field: "start_date" },
    endDate: { type: DataTypes.DATEONLY, allowNull: true, field: "end_date" },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_current" },
    grade: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    credentialId: { type: DataTypes.STRING, allowNull: true, field: "credential_id" },
    issuer: { type: DataTypes.STRING, allowNull: true },
    certificateNumber: { type: DataTypes.STRING, allowNull: true, field: "certificate_number" },
    expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: "expiry_date" },
    attachmentUrl: { type: DataTypes.STRING, allowNull: true, field: "attachment_url" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "resume_records", underscored: true },
);

export const LEAVE_TYPES = ["Annual", "Sick", "Unpaid", "Maternity", "Paternity", "Bereavement", "Other"] as const;

export class LeaveRecord extends Model<InferAttributes<LeaveRecord>, InferCreationAttributes<LeaveRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare leaveType: string;
  declare fromDate: string;
  declare toDate: string;
  declare days: number;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
LeaveRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    leaveType: { type: DataTypes.STRING, allowNull: false, field: "leave_type" },
    fromDate: { type: DataTypes.DATEONLY, allowNull: false, field: "from_date" },
    toDate: { type: DataTypes.DATEONLY, allowNull: false, field: "to_date" },
    days: { type: DataTypes.INTEGER, allowNull: false },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "leave_records", underscored: true },
);

export const DISCIPLINARY_STATUSES = ["Open", "Resolved", "Appealed"] as const;
export type DisciplinaryStatus = (typeof DISCIPLINARY_STATUSES)[number];

export class DisciplinaryRecord extends Model<InferAttributes<DisciplinaryRecord>, InferCreationAttributes<DisciplinaryRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare disciplineType: string;
  declare incidentDate: string;
  declare description: string;
  declare actionTaken: string | null;
  declare status: CreationOptional<DisciplinaryStatus>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
DisciplinaryRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    disciplineType: { type: DataTypes.STRING, allowNull: false, field: "discipline_type" },
    incidentDate: { type: DataTypes.DATEONLY, allowNull: false, field: "incident_date" },
    description: { type: DataTypes.TEXT, allowNull: false },
    actionTaken: { type: DataTypes.TEXT, allowNull: true, field: "action_taken" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "disciplinary_records", underscored: true },
);

export class PerformanceRecord extends Model<InferAttributes<PerformanceRecord>, InferCreationAttributes<PerformanceRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare reviewPeriod: string;
  declare rating: string;
  declare reviewerId: string | null;
  declare comments: string | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
PerformanceRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    reviewPeriod: { type: DataTypes.STRING, allowNull: false, field: "review_period" },
    rating: { type: DataTypes.STRING, allowNull: false },
    reviewerId: { type: DataTypes.UUID, allowNull: true, field: "reviewer_id" },
    comments: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "performance_records", underscored: true },
);
