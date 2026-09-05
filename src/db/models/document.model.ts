import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type DocumentFolderStatus = "Active" | "Archived";

/** A folder in the External Documents tree; org-scoped. */
export class DocumentFolder extends Model<InferAttributes<DocumentFolder>, InferCreationAttributes<DocumentFolder>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare description: string | null;
  declare status: CreationOptional<DocumentFolderStatus>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

DocumentFolder.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Archived"), allowNull: false, defaultValue: "Active" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "document_folders", underscored: true },
);

export type DocumentKind = "internal" | "external";
/**
 * OD `CD_STATUS` verbatim, in OD's order (js/core.js:19529) — the controlled
 * internal-document lifecycle. Was Draft/Published/Archived only.
 * `documents.status` is a plain STRING column (migration 0078), so widening
 * needs no migration.
 *
 * NOTE: external documents run a different OD vocabulary, `CD_EXT_STATUS`
 * (js/core.js:19530: Active / Under Review / Updated Version Available /
 * Superseded / Obsolete / Archived), and this port shares one `status`
 * column across both `kind`s. Adding those two extra members is a separate
 * change and is not made here.
 */
export type DocumentStatus =
  | "Draft" | "Under Review" | "Revision Requested" | "Approved" | "Published"
  | "Review Due" | "Superseded" | "Obsolete" | "Archived" | "Rejected";

export interface DocumentBlock {
  id: string;
  type: string;
  html: string;
}

/**
 * A document — Internal (block-editor content, `content` populated) or
 * External (a file/link filed under a folder, `folderId` populated).
 */
export class Document extends Model<InferAttributes<Document>, InferCreationAttributes<Document>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare kind: DocumentKind;
  declare title: string;
  declare docType: string | null;
  // ponytail: flat status field only — the OD `CD_STATUS` vocabulary is now
  // complete, but the transitions between its members are unenforced and OD's
  // signoff chain, ack tracking and version lineage are still out of scope.
  // Upgrade path: a DocumentApproval sub-table mirroring approval.models.ts
  // (ApprovalScheme/ApprovalRecord) once a review workflow is actually needed.
  declare status: CreationOptional<DocumentStatus>;
  declare version: CreationOptional<string>;
  declare content: DocumentBlock[] | null;
  declare folderId: string | null;
  declare issuer: string | null;
  declare link: string | null;
  declare effectiveDate: string | null;
  declare nextReview: string | null;
  declare owner: string | null;
  declare notes: string | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Document.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    kind: { type: DataTypes.ENUM("internal", "external"), allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    docType: { type: DataTypes.STRING, allowNull: true, field: "doc_type" },
    status: {
      type: DataTypes.ENUM(
        "Draft", "Under Review", "Revision Requested", "Approved", "Published",
        "Review Due", "Superseded", "Obsolete", "Archived", "Rejected",
      ),
      allowNull: false, defaultValue: "Draft",
    },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "0.1" },
    content: { type: DataTypes.JSONB, allowNull: true },
    folderId: { type: DataTypes.UUID, allowNull: true, field: "folder_id" },
    issuer: { type: DataTypes.STRING, allowNull: true },
    link: { type: DataTypes.STRING, allowNull: true },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    nextReview: { type: DataTypes.DATEONLY, allowNull: true, field: "next_review" },
    owner: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "documents", underscored: true },
);
