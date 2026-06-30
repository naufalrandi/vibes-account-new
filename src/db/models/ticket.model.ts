import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type TicketCategory =
  | "Technical Support" | "Billing" | "Commercial"
  | "Feature Request" | "Bug Report" | "General Inquiry";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Open" | "In Progress" | "Waiting for Customer" | "Resolved" | "Closed";
export type TicketScope = "sp" | "partner" | "tenant";

export interface TicketMessage {
  author: { name: string; kind: "user" | "support" };
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
export interface TicketCreatedBy {
  name: string;
  email: string;
}

/**
 * A support ticket. The threaded `messages`, the `activity` timeline, and
 * `attachments` metadata are JSONB arrays on the row. SLA metrics are derived on
 * read from these timestamps (see ticket.service.computeSla) — not stored.
 */
export class Ticket extends Model<InferAttributes<Ticket>, InferCreationAttributes<Ticket>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare subject: string;
  declare description: string;
  declare category: CreationOptional<TicketCategory>;
  declare priority: CreationOptional<TicketPriority>;
  declare status: CreationOptional<TicketStatus>;
  declare scope: TicketScope;
  declare orgId: string;
  declare managedBy: string | null;
  declare createdBy: TicketCreatedBy;
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
    description: { type: DataTypes.TEXT, allowNull: false },
    category: {
      type: DataTypes.ENUM("Technical Support", "Billing", "Commercial", "Feature Request", "Bug Report", "General Inquiry"),
      allowNull: false, defaultValue: "Technical Support",
    },
    priority: { type: DataTypes.ENUM("Low", "Medium", "High", "Critical"), allowNull: false, defaultValue: "Medium" },
    status: {
      type: DataTypes.ENUM("Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"),
      allowNull: false, defaultValue: "Open",
    },
    scope: { type: DataTypes.ENUM("sp", "partner", "tenant"), allowNull: false },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    managedBy: { type: DataTypes.STRING, allowNull: true, field: "managed_by" },
    createdBy: { type: DataTypes.JSONB, allowNull: false, field: "created_by" },
    assignedTo: { type: DataTypes.STRING, allowNull: true, field: "assigned_to" },
    messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "tickets", underscored: true },
);
