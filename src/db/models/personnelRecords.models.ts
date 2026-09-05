import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Personnel sub-record logs (OD `ent-personnel` Resume/Leaves/Disciplinary/
 * Performance tabs) — see migration 0082 for the original field-provenance
 * note (field names were inferred from HR convention at port time, when
 * `modules.js` was unavailable). The vocabularies and row shapes below have
 * since been read back against `js/modules.js` directly and carry their
 * baseline file:line; anything without such a citation is still inferred.
 */

export const RESUME_RECORD_TYPES = ["Education", "Experience", "Training", "Certification"] as const;
export type ResumeRecordType = (typeof RESUME_RECORD_TYPES)[number];

export class ResumeRecord extends Model<InferAttributes<ResumeRecord>, InferCreationAttributes<ResumeRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare recordType: ResumeRecordType;
  declare title: string;
  /**
   * Education level — OD `personAddEdu` (js/modules.js:5520) offers it as a
   * FREE-TEXT input (`<input id="ed-level" placeholder="Bachelor / Master">`),
   * not a picklist; the seeded values 'Master' / 'Bachelor' /
   * 'Bachelor (ongoing)' (js/modules.js:1078, 1085, 1095) are samples, not an
   * enum. Rendered as the first column of the Education card
   * (`personTabResume`, js/modules.js:4917).
   */
  declare level: string | null;
  declare organization: string | null;
  declare fieldOfStudy: string | null;
  declare location: string | null;
  /** OD `personAddTraining` (js/modules.js:5522) writes `{name, provider, year}`. */
  declare provider: string | null;
  /** Plain strings, not dates: OD stores education `year` as '2006', experience
   *  `to` as 'Present', certification `expiry` as '—'. See migration 0102. */
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
    level: { type: DataTypes.STRING, allowNull: true },
    organization: { type: DataTypes.STRING, allowNull: true },
    fieldOfStudy: { type: DataTypes.STRING, allowNull: true, field: "field_of_study" },
    location: { type: DataTypes.STRING, allowNull: true },
    provider: { type: DataTypes.STRING, allowNull: true },
    startDate: { type: DataTypes.STRING, allowNull: true, field: "start_date" },
    endDate: { type: DataTypes.STRING, allowNull: true, field: "end_date" },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_current" },
    grade: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    credentialId: { type: DataTypes.STRING, allowNull: true, field: "credential_id" },
    issuer: { type: DataTypes.STRING, allowNull: true },
    certificateNumber: { type: DataTypes.STRING, allowNull: true, field: "certificate_number" },
    expiryDate: { type: DataTypes.STRING, allowNull: true, field: "expiry_date" },
    attachmentUrl: { type: DataTypes.STRING, allowNull: true, field: "attachment_url" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "resume_records", underscored: true },
);

/**
 * Personnel-profile leave types — copied from OD `personAddLeave`
 * (js/modules.js:5524), which is the modal that writes this row (`h.leaves`,
 * shape `{type, from, to, days, status}`).
 *
 * NOTE: OD has a SECOND, different leave vocabulary — `LEAVE_TYPES` at
 * js/modules.js:3469 (`['Annual','Sick','Unpaid','Maternity / Paternity',
 * 'Compassionate']`) — which belongs to the self-service *leave request*
 * workflow (`db.leaveRequests`, stored here under business records, see
 * `modules/business/dataSchemas.ts`). The two lists genuinely differ
 * ('Maternity/Paternity' vs 'Maternity / Paternity'; 'Other' vs
 * 'Compassionate') and are deliberately NOT merged.
 */
export const LEAVE_TYPES = ["Annual", "Sick", "Unpaid", "Maternity/Paternity", "Other"] as const;

/** OD `personAddLeave` status picklist (js/modules.js:5524); the list card
 * defaults a missing value to 'Pending' (js/modules.js:4926). */
export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export class LeaveRecord extends Model<InferAttributes<LeaveRecord>, InferCreationAttributes<LeaveRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare leaveType: string;
  declare fromDate: string;
  declare toDate: string;
  declare days: number;
  declare status: CreationOptional<LeaveStatus>;
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
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Pending" },
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
  /** OD's optional `note` (js/modules.js:5525); the design imposes no required text. */
  declare description: string | null;
  declare actionTaken: string | null;
  /** OD `personAddDisc` (js/modules.js:5525) — Low / Medium / High, rendered as
   *  its own tag column at js/modules.js:4929. */
  declare severity: string | null;
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
    description: { type: DataTypes.TEXT, allowNull: true },
    actionTaken: { type: DataTypes.TEXT, allowNull: true, field: "action_taken" },
    severity: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "disciplinary_records", underscored: true },
);

/** OD `personAddPerf` rating picklist (js/modules.js:5526). */
export const PERFORMANCE_RATINGS = ["Exceeds", "Meets", "Below"] as const;
export type PerformanceRating = (typeof PERFORMANCE_RATINGS)[number];

export class PerformanceRecord extends Model<InferAttributes<PerformanceRecord>, InferCreationAttributes<PerformanceRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare reviewPeriod: string;
  declare rating: string;
  /**
   * Reviewer as OD stores it — FREE TEXT, not a person link: `personAddPerf`
   * reads it from `<input id="pf-rev">` (js/modules.js:5526) and the seeded
   * axia1 review has `reviewer:'Board'` (js/modules.js:1080), which is a body,
   * not a user. `reviewerId` stays as the optional structured link for the
   * common case where the reviewer IS a platform user.
   */
  declare reviewer: string | null;
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
    reviewer: { type: DataTypes.STRING, allowNull: true },
    reviewerId: { type: DataTypes.UUID, allowNull: true, field: "reviewer_id" },
    comments: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "performance_records", underscored: true },
);
