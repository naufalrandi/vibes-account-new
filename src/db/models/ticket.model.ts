import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type TicketCategory = "Technical Support" | "Billing" | "Commercial" | "Feature Request" | "Bug Report" | "General Inquiry";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Open" | "In Progress" | "Waiting for Customer" | "Resolved" | "Closed";
export type TicketScope = "sp" | "partner" | "tenant";

export const TICKET_CATEGORIES: TicketCategory[] = ["Technical Support", "Billing", "Commercial", "Feature Request", "Bug Report", "General Inquiry"];
export const TICKET_PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];
export const TICKET_STATUSES: TicketStatus[] = ["Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"];

export interface TicketAuthor {
  name: string;
  kind: "user" | "support";
}
export interface TicketMessage {
  author: TicketAuthor;
  text: string;
  ts: string;
}
export interface TicketActivity {
  event: string;
  ts: string;
}
export interface TicketAttachment {
  name: string;
  size: number;
  date: string;
}
export interface TicketCreator {
  name: string;
  email: string;
}

/**
 * A support ticket raised by a persona (Service Provider / Partner / Tenant).
 * `orgId` is the owning org (drives scoping); `orgName`/`managedBy` are
 * denormalized display strings. The conversation thread and activity timeline are
 * JSONB arrays. Status/priority/category are STRING (mutable AXIA labels).
 */
export class Ticket extends Model<InferAttributes<Ticket>, InferCreationAttributes<Ticket>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare subject: string;
  declare description: CreationOptional<string>;
  declare category: string;
  declare priority: CreationOptional<TicketPriority>;
  declare status: CreationOptional<TicketStatus>;
  declare scope: CreationOptional<TicketScope>;
  declare orgId: string;
  declare orgName: CreationOptional<string>;
  declare managedBy: string | null;
  declare createdBy: CreationOptional<TicketCreator>;
  declare assignedTo: string | null;
  declare messages: CreationOptional<TicketMessage[]>;
  declare activity: CreationOptional<TicketActivity[]>;
  declare attachments: CreationOptional<TicketAttachment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Ticket.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    category: { type: DataTypes.STRING, allowNull: false },
    priority: { type: DataTypes.STRING, allowNull: false, defaultValue: "Medium" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    scope: { type: DataTypes.STRING, allowNull: false, defaultValue: "tenant" },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    orgName: { type: DataTypes.STRING, allowNull: false, defaultValue: "", field: "org_name" },
    managedBy: { type: DataTypes.STRING, allowNull: true, field: "managed_by" },
    createdBy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "created_by" },
    assignedTo: { type: DataTypes.STRING, allowNull: true, field: "assigned_to" },
    messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "tickets", underscored: true },
);
