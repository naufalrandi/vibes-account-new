import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Competence master data (the SP-owned libraries that role competence profiles
 * and assessments reference): the ISCED education ladder, the hard/soft Skill
 * library, and the Training catalogue. Roles / assignments / assessments /
 * instruments build on these in later slices.
 */

export const SKILL_TYPES = ["hard", "soft"] as const;
export const TRAINING_SOURCES = ["SP", "Tenant"] as const;
export const METHOD_POOL = ["Written exam", "Interview", "Practical assessment", "Portfolio review", "Observation"] as const;
export type SkillType = (typeof SKILL_TYPES)[number];
export type TrainingSource = (typeof TRAINING_SOURCES)[number];

export class CompetenceEducation extends Model<InferAttributes<CompetenceEducation>, InferCreationAttributes<CompetenceEducation>> {
  declare id: CreationOptional<string>;
  declare level: number;
  declare label: string;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceEducation.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    level: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    label: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_education", underscored: true },
);

export class CompetenceSkill extends Model<InferAttributes<CompetenceSkill>, InferCreationAttributes<CompetenceSkill>> {
  declare id: CreationOptional<string>;
  /** null → platform-global (SP) library skill; otherwise the owning tenant org. */
  declare orgId: CreationOptional<string | null>;
  declare name: string;
  declare type: string;
  declare description: string | null;
  declare methods: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceSkill.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "hard" },
    description: { type: DataTypes.TEXT, allowNull: true },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_skills", underscored: true },
);

export const ROLE_STATUS = ["Draft", "Active", "Under review", "Archived"] as const;
export const NECESSITY = ["Required", "Preferred"] as const;
export const ASSESS_STATUS = ["Competent", "Competent with conditions", "Not yet competent"] as const;
export const GAP_STATUS = ["Open", "Planned", "Resolved"] as const;
export const PROF_LEVELS = ["", "Awareness", "Working", "Proficient", "Expert"] as const;

/** A competence linked to a responsibility/authority on a role profile. */
export interface ProfileRequirement { kind: "training" | "hard" | "soft"; refId: string; necessity: string; level?: number; reviewFreq?: string }
export interface ProfileItem { id: string; text: string; comps: ProfileRequirement[] }
export interface ExperienceReq { id: string; sector: string; years: string }
/** A single line in an assessment checklist (snapshot of the role profile). */
export interface AssessReqResult {
  key: string; kind: string; refId?: string; label: string; necessity: string;
  evalType: "threshold" | "passfail" | "proficiency"; reqLevel: number; assessedLevel: number;
  result: string; methods: string[]; method: string; reviewFreq: string;
  evidence: string; reviewNotes: string; attachments: { name: string; size: number; at: string; by: string }[];
}
export interface IaEnvelopeEntry { ts: string; user: string; action: string; summary?: string }

export class CompetenceRole extends Model<InferAttributes<CompetenceRole>, InferCreationAttributes<CompetenceRole>> {
  declare id: CreationOptional<string>;
  /** null → Service-Provider / enterprise role; otherwise the owning tenant org. */
  declare orgId: string | null;
  declare name: string;
  declare description: string | null;
  declare status: CreationOptional<string>;
  declare reviewFreq: CreationOptional<string>;
  declare eduMinLevelId: string | null;
  declare eduFields: CreationOptional<string[]>;
  declare eduCountry: string | null;
  declare expReqs: CreationOptional<ExperienceReq[]>;
  declare responsibilities: CreationOptional<ProfileItem[]>;
  declare authorities: CreationOptional<ProfileItem[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceRole.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    reviewFreq: { type: DataTypes.STRING, allowNull: false, defaultValue: "12", field: "review_freq" },
    eduMinLevelId: { type: DataTypes.UUID, allowNull: true, field: "edu_min_level_id" },
    eduFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "edu_fields" },
    eduCountry: { type: DataTypes.STRING, allowNull: true, field: "edu_country" },
    expReqs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "exp_reqs" },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_roles", underscored: true },
);

export class CompetenceAssignment extends Model<InferAttributes<CompetenceAssignment>, InferCreationAttributes<CompetenceAssignment>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare personId: string;
  declare personName: string | null;
  declare roleId: string;
  declare assignedDate: string | null;
  declare status: CreationOptional<string>;
  declare latestAssessmentId: string | null;
  declare latestStatus: string | null;
  declare latestDate: string | null;
  declare validUntil: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceAssignment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    personId: { type: DataTypes.UUID, allowNull: false, field: "person_id" },
    personName: { type: DataTypes.STRING, allowNull: true, field: "person_name" },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    assignedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "assigned_date" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    latestAssessmentId: { type: DataTypes.UUID, allowNull: true, field: "latest_assessment_id" },
    latestStatus: { type: DataTypes.STRING, allowNull: true, field: "latest_status" },
    latestDate: { type: DataTypes.DATEONLY, allowNull: true, field: "latest_date" },
    validUntil: { type: DataTypes.DATEONLY, allowNull: true, field: "valid_until" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_assignments", underscored: true },
);

export class CompetenceAssessment extends Model<InferAttributes<CompetenceAssessment>, InferCreationAttributes<CompetenceAssessment>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare assignmentId: string;
  declare personId: string;
  declare roleId: string;
  declare assessor: string | null;
  declare date: string | null;
  declare notes: string | null;
  declare requirements: CreationOptional<AssessReqResult[]>;
  declare score: CreationOptional<number>;
  declare openGaps: CreationOptional<number>;
  declare status: CreationOptional<string>;
  declare validUntil: string | null;
  declare approvalState: CreationOptional<string>;
  declare approvedBy: string | null;
  declare approvedDate: string | null;
  declare activity: CreationOptional<IaEnvelopeEntry[]>;
  declare comments: CreationOptional<{ id: string; user: string; ts: string; text: string }[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceAssessment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    assignmentId: { type: DataTypes.UUID, allowNull: false, field: "assignment_id" },
    personId: { type: DataTypes.UUID, allowNull: false, field: "person_id" },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    assessor: { type: DataTypes.STRING, allowNull: true },
    date: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    requirements: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    openGaps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "open_gaps" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Not yet competent" },
    validUntil: { type: DataTypes.DATEONLY, allowNull: true, field: "valid_until" },
    approvalState: { type: DataTypes.STRING, allowNull: false, defaultValue: "Pending", field: "approval_state" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "approved_date" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_assessments", underscored: true },
);

export class CompetenceGap extends Model<InferAttributes<CompetenceGap>, InferCreationAttributes<CompetenceGap>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare assessmentId: string | null;
  declare assignmentId: string;
  declare personId: string;
  declare roleId: string;
  declare reqKey: string;
  declare reqLabel: string | null;
  declare kind: string | null;
  declare evalType: string | null;
  declare currentLevel: CreationOptional<number>;
  declare requiredLevel: CreationOptional<number>;
  declare severity: string;
  declare action: string | null;
  declare owner: string | null;
  declare due: string | null;
  declare training: string | null;
  declare trainingDone: CreationOptional<boolean>;
  declare trainingDate: string | null;
  declare status: CreationOptional<string>;
  declare resolvedDate: string | null;
  declare resolvedBy: string | null;
  declare createdDate: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceGap.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    assessmentId: { type: DataTypes.UUID, allowNull: true, field: "assessment_id" },
    assignmentId: { type: DataTypes.UUID, allowNull: false, field: "assignment_id" },
    personId: { type: DataTypes.UUID, allowNull: false, field: "person_id" },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    reqKey: { type: DataTypes.STRING, allowNull: false, field: "req_key" },
    reqLabel: { type: DataTypes.STRING, allowNull: true, field: "req_label" },
    kind: { type: DataTypes.STRING, allowNull: true },
    evalType: { type: DataTypes.STRING, allowNull: true, field: "eval_type" },
    currentLevel: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "current_level" },
    requiredLevel: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "required_level" },
    severity: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.TEXT, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    due: { type: DataTypes.DATEONLY, allowNull: true },
    training: { type: DataTypes.STRING, allowNull: true },
    trainingDone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "training_done" },
    trainingDate: { type: DataTypes.DATEONLY, allowNull: true, field: "training_date" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    resolvedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "resolved_date" },
    resolvedBy: { type: DataTypes.STRING, allowNull: true, field: "resolved_by" },
    createdDate: { type: DataTypes.DATEONLY, allowNull: true, field: "created_date" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_gaps", underscored: true },
);

export const INSTRUMENT_STATUS = ["Draft", "Published"] as const;
export const EXAM_QTYPES = ["single", "multi", "truefalse", "short"] as const;
/** Exam-attempt lifecycle: short-answer exams wait for assessor grading before finalizing. */
export const ATTEMPT_STATUS = ["PendingGrading", "Completed"] as const;

export interface ExamOption { id: string; text: string; correct: boolean }
export interface ExamQuestion { id: string; type: string; text: string; points: number; explanation?: string; ref?: string; options?: ExamOption[]; answerTrue?: boolean; model?: string }
export interface PracticalCriterion { id: string; text: string; points: number; guidance?: string }

export class CompetenceExamInstrument extends Model<InferAttributes<CompetenceExamInstrument>, InferCreationAttributes<CompetenceExamInstrument>> {
  declare id: CreationOptional<string>;
  /** null → platform-global (SP) instrument; otherwise the owning tenant org. */
  declare orgId: CreationOptional<string | null>;
  declare skillId: string;
  declare level: number;
  declare name: string;
  declare status: CreationOptional<string>;
  declare passMark: CreationOptional<number>;
  declare durationMin: CreationOptional<number>;
  declare attempts: CreationOptional<number>;
  declare shuffleQ: CreationOptional<boolean>;
  declare drawCount: CreationOptional<number>;
  declare questions: CreationOptional<ExamQuestion[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceExamInstrument.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    skillId: { type: DataTypes.UUID, allowNull: false, field: "skill_id" },
    level: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    passMark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 70, field: "pass_mark" },
    durationMin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, field: "duration_min" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    shuffleQ: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "shuffle_q" },
    drawCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "draw_count" },
    questions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_exam_instruments", underscored: true },
);

export class CompetencePracticalInstrument extends Model<InferAttributes<CompetencePracticalInstrument>, InferCreationAttributes<CompetencePracticalInstrument>> {
  declare id: CreationOptional<string>;
  /** null → platform-global (SP) instrument; otherwise the owning tenant org. */
  declare orgId: CreationOptional<string | null>;
  declare skillId: string;
  declare level: CreationOptional<number>;
  declare name: string;
  declare status: CreationOptional<string>;
  declare passMark: CreationOptional<number>;
  declare criteria: CreationOptional<PracticalCriterion[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetencePracticalInstrument.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    skillId: { type: DataTypes.UUID, allowNull: false, field: "skill_id" },
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4 },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    passMark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 75, field: "pass_mark" },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_practical_instruments", underscored: true },
);

export class CompetenceExamAttempt extends Model<InferAttributes<CompetenceExamAttempt>, InferCreationAttributes<CompetenceExamAttempt>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare instrumentId: string;
  declare skillId: string;
  declare level: number;
  declare personId: string;
  declare personName: string | null;
  declare score: number;
  declare earned: number;
  declare total: number;
  declare passed: boolean;
  declare preview: CreationOptional<boolean>;
  /** "PendingGrading" while short answers await the assessor; "Completed" once final. */
  declare status: CreationOptional<string>;
  /** The candidate's raw answers keyed by question id (kept for the grading view). */
  declare answers: CreationOptional<Record<string, unknown>>;
  /** Assessor-awarded points per short-answer question id. */
  declare grades: CreationOptional<Record<string, number>>;
  declare takenAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceExamAttempt.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    instrumentId: { type: DataTypes.UUID, allowNull: false, field: "instrument_id" },
    skillId: { type: DataTypes.UUID, allowNull: false, field: "skill_id" },
    level: { type: DataTypes.INTEGER, allowNull: false },
    personId: { type: DataTypes.UUID, allowNull: false, field: "person_id" },
    personName: { type: DataTypes.STRING, allowNull: true, field: "person_name" },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    earned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    preview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Completed" },
    answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    grades: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    takenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "taken_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_exam_attempts", underscored: true },
);

export class CompetencePracticalAttempt extends Model<InferAttributes<CompetencePracticalAttempt>, InferCreationAttributes<CompetencePracticalAttempt>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare instrumentId: string;
  declare skillId: string;
  declare level: CreationOptional<number>;
  declare personId: string;
  declare personName: string | null;
  declare assessor: string | null;
  declare evidence: string | null;
  declare score: number;
  declare earned: number;
  declare total: number;
  declare passed: boolean;
  declare preview: CreationOptional<boolean>;
  declare takenAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetencePracticalAttempt.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    instrumentId: { type: DataTypes.UUID, allowNull: false, field: "instrument_id" },
    skillId: { type: DataTypes.UUID, allowNull: false, field: "skill_id" },
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4 },
    personId: { type: DataTypes.UUID, allowNull: false, field: "person_id" },
    personName: { type: DataTypes.STRING, allowNull: true, field: "person_name" },
    assessor: { type: DataTypes.STRING, allowNull: true },
    evidence: { type: DataTypes.TEXT, allowNull: true },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    earned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    preview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    takenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "taken_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_practical_attempts", underscored: true },
);

export class CompetenceTraining extends Model<InferAttributes<CompetenceTraining>, InferCreationAttributes<CompetenceTraining>> {
  declare id: CreationOptional<string>;
  /** null → Service-Provider-global course; otherwise the owning tenant org. */
  declare orgId: string | null;
  declare name: string;
  declare source: CreationOptional<string>;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceTraining.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: "SP" },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_training", underscored: true },
);
