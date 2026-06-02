import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

export const up: Migration = async ({ context: q }) => {
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("organizations", {
    id: uuid,
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: { type: DataTypes.ENUM("ServiceOwner", "Distributor", "Tenant"), allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "PendingApproval", "Active", "Suspended", "Inactive"), allowNull: false, defaultValue: "Draft" },
    parent_org_id: { type: DataTypes.UUID, allowNull: true },
    tenant_id: { type: DataTypes.UUID, allowNull: true },
    email: DataTypes.STRING,
    phone: DataTypes.STRING,
    website: DataTypes.STRING,
    country: DataTypes.STRING,
    address: DataTypes.STRING,
    ...ts,
  });

  await q.createTable("users", {
    id: uuid,
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" } },
    tenant_id: { type: DataTypes.UUID, allowNull: true },
    full_name: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password_hash: DataTypes.STRING,
    status: { type: DataTypes.ENUM("PendingActivation", "Active", "Suspended", "Inactive"), allowNull: false, defaultValue: "PendingActivation" },
    position: DataTypes.STRING,
    work_unit: DataTypes.STRING,
    last_login: DataTypes.DATE,
    activation_token: DataTypes.STRING,
    reset_token: DataTypes.STRING,
    reset_expires: DataTypes.DATE,
    ...ts,
  });

  await q.createTable("roles", {
    id: uuid,
    name: { type: DataTypes.STRING, allowNull: false },
    tier_scope: { type: DataTypes.ENUM("ServiceOwner", "Distributor", "Tenant"), allowNull: false },
    org_id: { type: DataTypes.UUID, allowNull: true },
    is_super_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });

  await q.createTable("menus", {
    id: uuid,
    parent_id: { type: DataTypes.UUID, allowNull: true, references: { model: "menus", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    heading: DataTypes.STRING,
    route: DataTypes.STRING,
    route_seo: DataTypes.STRING,
    icon: DataTypes.STRING,
    sorting: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });

  await q.createTable("actions", {
    id: uuid,
    menu_id: { type: DataTypes.UUID, allowNull: false, references: { model: "menus", key: "id" }, onDelete: "CASCADE" },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    sorting: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });

  await q.createTable("user_roles", {
    user_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    role_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "roles", key: "id" }, onDelete: "CASCADE" },
  });

  await q.createTable("role_menu_grants", {
    id: uuid,
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "roles", key: "id" }, onDelete: "CASCADE" },
    menu_id: { type: DataTypes.UUID, allowNull: false, references: { model: "menus", key: "id" }, onDelete: "CASCADE" },
    granted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  await q.createTable("role_action_grants", {
    id: uuid,
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "roles", key: "id" }, onDelete: "CASCADE" },
    action_id: { type: DataTypes.UUID, allowNull: false, references: { model: "actions", key: "id" }, onDelete: "CASCADE" },
    granted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  await q.createTable("subscriptions", {
    id: uuid,
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" } },
    plan: { type: DataTypes.STRING, allowNull: false },
    entitlements: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    start_date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    end_date: DataTypes.DATE,
  });

  await q.createTable("registration_requests", {
    id: uuid,
    distributor_org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" } },
    proposed_tenant: { type: DataTypes.JSONB, allowNull: false },
    status: { type: DataTypes.ENUM("PendingApproval", "Approved", "Rejected"), allowNull: false, defaultValue: "PendingApproval" },
    decision_reason: DataTypes.STRING,
    ...ts,
  });

  await q.createTable("audit_logs", {
    id: uuid,
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actor_user_id: DataTypes.UUID,
    organization_id: DataTypes.UUID,
    tenant_id: DataTypes.UUID,
    action: { type: DataTypes.STRING, allowNull: false },
    entity_type: { type: DataTypes.STRING, allowNull: false },
    entity_id: DataTypes.UUID,
    source_ip: DataTypes.STRING,
    result: { type: DataTypes.ENUM("Success", "Failure"), allowNull: false },
    metadata: DataTypes.JSONB,
  });

  await q.createTable("login_history", {
    id: uuid,
    user_id: DataTypes.UUID,
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    source_ip: DataTypes.STRING,
    result: { type: DataTypes.ENUM("Success", "Failure"), allowNull: false },
  });

  await q.createTable("refresh_tokens", {
    id: uuid,
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    token_hash: { type: DataTypes.STRING, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: DataTypes.DATE,
  });

  // Revoke UPDATE/DELETE on audit_logs would require a dedicated DB role; we enforce
  // immutability in code (no update/delete path). Add an index for read performance.
  await q.addIndex("audit_logs", ["organization_id", "at"]);
  await q.addIndex("users", ["org_id"]);
  await q.addIndex("users", ["tenant_id"]);
  await q.addIndex("role_menu_grants", ["role_id", "menu_id"], { unique: true });
  await q.addIndex("role_action_grants", ["role_id", "action_id"], { unique: true });
};

export const down: Migration = async ({ context: q }) => {
  for (const t of [
    "refresh_tokens",
    "login_history",
    "audit_logs",
    "registration_requests",
    "subscriptions",
    "role_action_grants",
    "role_menu_grants",
    "user_roles",
    "actions",
    "menus",
    "users",
    "roles",
    "organizations",
  ]) {
    await q.dropTable(t);
  }
};
