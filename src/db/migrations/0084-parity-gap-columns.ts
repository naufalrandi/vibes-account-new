import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-58 — closes the design/backend field-parity gaps enumerated by the
 * backend-parity audit (`parity/backend.md`) that are genuine missing
 * columns (not relation-reachable, not a rename). Three groups, all additive:
 *  1. Straightforward new scalar columns (§1 of the spec).
 *  2. The `lastUpdatedBy`/`activity`/`comments` audit-trail triple already
 *     used by the IA entities (`internalAudit.models.ts`), extended to
 *     RoleTemplate / WorkUnit / CompetenceAssignment, plus a plain `audit`
 *     JSONB column on SiteRequest (same shape as TenantProfile.audit) (§2).
 *  3. Columns with no clean existing relation/synonym: TenantProfile admin
 *     link + billing/revenueShare/selfApprovalAllowed, PartnerProfile
 *     agreement (§6).
 */
export const up: Migration = async ({ context: q }) => {
  // ---- §1: straightforward new columns ----
  await q.addColumn("business_processes", "subgroup", { type: DataTypes.STRING, allowNull: true });

  await q.addColumn("framework_requirements", "assessable", {
    type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true,
  });

  await q.addColumn("frameworks", "discipline_id", { type: DataTypes.STRING, allowNull: true });

  await q.addColumn("fwrc", "status", { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" });

  await q.addColumn("competence_gaps", "reviewed_by", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("competence_gaps", "reviewed_date", { type: DataTypes.DATEONLY, allowNull: true });

  await q.addColumn("ia_findings", "criteria_reqs", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("ia_sessions", "criteria_reqs", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  await q.addColumn("ia_plans", "department", { type: DataTypes.STRING, allowNull: true });

  await q.addColumn("reference_education_fields", "extension", { type: DataTypes.BOOLEAN, allowNull: true });

  await q.addColumn("competence_roles", "emp_level", { type: DataTypes.STRING, allowNull: true });

  // ---- §2: audit-trail triple ----
  await q.addColumn("role_templates", "last_updated_by", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("role_templates", "activity", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("role_templates", "comments", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  await q.addColumn("work_units", "last_updated_by", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("work_units", "activity", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("work_units", "comments", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  await q.addColumn("competence_assignments", "last_updated_by", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("competence_assignments", "activity", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("competence_assignments", "comments", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  await q.addColumn("site_requests", "audit", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });

  // ---- §6: no clean relation/synonym ----
  await q.addColumn("tenant_profiles", "admin_user_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("tenant_profiles", "billing", { type: DataTypes.JSONB, allowNull: true, defaultValue: null });
  await q.addColumn("tenant_profiles", "revenue_share", { type: DataTypes.JSONB, allowNull: true, defaultValue: [] });
  await q.addColumn("tenant_profiles", "self_approval_allowed", {
    type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true,
  });

  await q.addColumn("partner_profiles", "agreement", { type: DataTypes.JSONB, allowNull: true, defaultValue: null });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("partner_profiles", "agreement");

  await q.removeColumn("tenant_profiles", "self_approval_allowed");
  await q.removeColumn("tenant_profiles", "revenue_share");
  await q.removeColumn("tenant_profiles", "billing");
  await q.removeColumn("tenant_profiles", "admin_user_id");

  await q.removeColumn("site_requests", "audit");

  await q.removeColumn("competence_assignments", "comments");
  await q.removeColumn("competence_assignments", "activity");
  await q.removeColumn("competence_assignments", "last_updated_by");

  await q.removeColumn("work_units", "comments");
  await q.removeColumn("work_units", "activity");
  await q.removeColumn("work_units", "last_updated_by");

  await q.removeColumn("role_templates", "comments");
  await q.removeColumn("role_templates", "activity");
  await q.removeColumn("role_templates", "last_updated_by");

  await q.removeColumn("competence_roles", "emp_level");
  await q.removeColumn("reference_education_fields", "extension");
  await q.removeColumn("ia_plans", "department");
  await q.removeColumn("ia_sessions", "criteria_reqs");
  await q.removeColumn("ia_findings", "criteria_reqs");
  await q.removeColumn("competence_gaps", "reviewed_date");
  await q.removeColumn("competence_gaps", "reviewed_by");
  await q.removeColumn("fwrc", "status");
  await q.removeColumn("frameworks", "discipline_id");
  await q.removeColumn("framework_requirements", "assessable");
  await q.removeColumn("business_processes", "subgroup");
};
