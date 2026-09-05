import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * OD's contract-document lifecycle is exactly Draft -> Issued -> Signed
 * (`cdIssue`/`cdRevise`/`cdSign`, js/modules.js:5390-5392; the status tag in
 * `personContractDocCard`, js/modules.js:5242, is a three-branch ternary with
 * no fourth state). The port-only extras "Final" and "Expired" — which had no
 * writer anywhere in src/ or the seeders — were dropped by migration 0101,
 * which also recreated the Postgres enum type and reset `version`'s default to
 * OD's 0 (`cdDraftContract` modules.js:5257; only `cdIssue` increments it).
 */
export type ContractDocStatus = "Draft" | "Issued" | "Signed";

/** A single clause snapshot in `clauses` (OD `cdCapture`, `modules.js:5251`). */
export interface ContractDocClause {
  title: string;
  category: string;
  body: string;
  origTitle?: string;
  origBody?: string;
  sourceId: string;
  edited: boolean;
  include: boolean;
}

/**
 * Contract-document editor record (OD `personContractDocCard`/`cdEditorRender`,
 * `cdDraftContract` `modules.js:5232-5251`). `typeId`/`templateId`/`country`/
 * `issuedDate`/`clauses` close the SOF-58 `contractDocs` parity gap on top of
 * the original generic shape.
 */
export class PersonnelContractDocument extends Model<
  InferAttributes<PersonnelContractDocument>,
  InferCreationAttributes<PersonnelContractDocument>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare title: string;
  declare docType: string | null;
  declare status: CreationOptional<ContractDocStatus>;
  declare version: CreationOptional<number>;
  declare content: string | null;
  declare effectiveDate: string | null;
  declare expiryDate: string | null;
  declare signedBy: string | null;
  declare signedAt: Date | null;
  /** Source `contractTypes` row (`ent-ctypes` BusinessRecord id). OD `typeId`. */
  declare typeId: string | null;
  /** Jurisdiction, from `personJurisdiction(h)`. */
  declare country: string | null;
  /** Source `contractTemplates` row (`ent-ctype-templates` BusinessRecord id). */
  declare templateId: string | null;
  declare issuedDate: string | null;
  declare clauses: CreationOptional<ContractDocClause[]>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PersonnelContractDocument.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    docType: { type: DataTypes.STRING, allowNull: true, field: "doc_type" },
    status: { type: DataTypes.ENUM("Draft", "Issued", "Signed"), allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    content: { type: DataTypes.TEXT, allowNull: true },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: "expiry_date" },
    signedBy: { type: DataTypes.STRING, allowNull: true, field: "signed_by" },
    signedAt: { type: DataTypes.DATE, allowNull: true, field: "signed_at" },
    typeId: { type: DataTypes.UUID, allowNull: true, field: "type_id" },
    country: { type: DataTypes.STRING, allowNull: true },
    templateId: { type: DataTypes.UUID, allowNull: true, field: "template_id" },
    issuedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "issued_date" },
    clauses: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "personnel_contract_documents", underscored: true },
);

/** Activity timeline entry — freeform log over personnel-record writes. */
export class PersonnelActivityLog extends Model<
  InferAttributes<PersonnelActivityLog>,
  InferCreationAttributes<PersonnelActivityLog>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare actor: string | null;
  declare action: string;
  declare detail: string | null;
  declare meta: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
}

PersonnelActivityLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    actor: { type: DataTypes.STRING, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    detail: { type: DataTypes.TEXT, allowNull: true },
    meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
  },
  { sequelize, tableName: "personnel_activity_log", underscored: true, updatedAt: false },
);

/** Onboarding checklist item. */
export class PersonnelOnboardingItem extends Model<
  InferAttributes<PersonnelOnboardingItem>,
  InferCreationAttributes<PersonnelOnboardingItem>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare label: string;
  /** OD `ONBOARD_TEMPLATE` task `group` — '' for an ad-hoc task with no section. */
  declare group: CreationOptional<string>;
  /** OD `ONBOARD_TEMPLATE` task `required` — a blocking task rather than an optional one. */
  declare required: CreationOptional<boolean>;
  declare seq: CreationOptional<number>;
  declare done: CreationOptional<boolean>;
  declare doneAt: Date | null;
  declare doneBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PersonnelOnboardingItem.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    label: { type: DataTypes.STRING, allowNull: false },
    group: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    done: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    doneAt: { type: DataTypes.DATE, allowNull: true, field: "done_at" },
    doneBy: { type: DataTypes.STRING, allowNull: true, field: "done_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "personnel_onboarding_items", underscored: true },
);

/** Compensation & bank binding — person-side link to an `ent-comp` BusinessRecord + bank/tax fields. */
export class PersonnelCompensation extends Model<
  InferAttributes<PersonnelCompensation>,
  InferCreationAttributes<PersonnelCompensation>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare compRecordId: string | null;
  declare bankName: string | null;
  declare bankAccountNo: string | null;
  declare bankAccountName: string | null;
  declare taxId: string | null;
  declare taxStatus: string | null;
  declare effectiveDate: string | null;
  declare minwageRecordId: string | null;
  declare minwageCompliant: boolean | null;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PersonnelCompensation.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "user_id" },
    compRecordId: { type: DataTypes.UUID, allowNull: true, field: "comp_record_id" },
    bankName: { type: DataTypes.STRING, allowNull: true, field: "bank_name" },
    bankAccountNo: { type: DataTypes.STRING, allowNull: true, field: "bank_account_no" },
    bankAccountName: { type: DataTypes.STRING, allowNull: true, field: "bank_account_name" },
    taxId: { type: DataTypes.STRING, allowNull: true, field: "tax_id" },
    taxStatus: { type: DataTypes.STRING, allowNull: true, field: "tax_status" },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    minwageRecordId: { type: DataTypes.UUID, allowNull: true, field: "minwage_record_id" },
    minwageCompliant: { type: DataTypes.BOOLEAN, allowNull: true, field: "minwage_compliant" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "personnel_compensation", underscored: true },
);
