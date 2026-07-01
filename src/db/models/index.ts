import { Organization } from "./organization.model";
import { User } from "./user.model";
import { Role } from "./role.model";
import { Menu } from "./menu.model";
import { Action } from "./action.model";
import { UserRole } from "./userRole.model";
import { RoleMenuGrant } from "./roleMenuGrant.model";
import { RoleActionGrant } from "./roleActionGrant.model";
import { Subscription } from "./subscription.model";
import { RegistrationRequest } from "./registrationRequest.model";
import { AuditLog } from "./auditLog.model";
import { LoginHistory } from "./loginHistory.model";
import { RefreshToken } from "./refreshToken.model";
import { FrameworkType } from "./frameworkType.model";
import { FrameworkFamily } from "./frameworkFamily.model";
import { Framework } from "./framework.model";
import { OrganizationFramework } from "./organizationFramework.model";
import { Profile } from "./profile.model";
import { Account } from "./account.model";
import { OrgSignatory } from "./orgSignatory.model";
import { PartnerProfile } from "./partnerProfile.model";
import { AgreementTemplate } from "./agreementTemplate.model";
import { PartnerAgreement } from "./partnerAgreement.model";
import { TenantProfile } from "./tenantProfile.model";
import { Site } from "./site.model";
import { SiteRequest } from "./siteRequest.model";
import { FrameworkAssignment } from "./frameworkAssignment.model";
import { Plan, Invoice, Payment, Receipt, RevenueShareStatement, Payout } from "./billing.models";
import { Ticket } from "./ticket.model";
import {
  FrameworkGroup, FrameworkElement, FrameworkRequirement, RequirementCriterion,
  ElementRequirementXref, ConformanceQuestion, ConformanceResponse,
} from "./frameworkMeta.models";
import { Assessment, AssessmentAnswer, Gap } from "./assessment.models";
import { ImplementationRecord } from "./implementationRecord.model";

let initialized = false;

export function initModels(): void {
  if (initialized) return;
  Organization.hasMany(User, { foreignKey: "orgId" });
  User.belongsTo(Organization, { foreignKey: "orgId" });

  Organization.hasMany(Organization, { foreignKey: "parentOrgId", as: "children" });
  Organization.belongsTo(Organization, { foreignKey: "parentOrgId", as: "parent" });

  // A user may hold many roles; effective access is the union of their grants.
  User.belongsToMany(Role, { through: UserRole, foreignKey: "userId", otherKey: "roleId" });
  Role.belongsToMany(User, { through: UserRole, foreignKey: "roleId", otherKey: "userId" });

  // Menu tree (self-reference) + actions per menu.
  Menu.hasMany(Menu, { foreignKey: "parentId", as: "children" });
  Menu.belongsTo(Menu, { foreignKey: "parentId", as: "parent" });
  Menu.hasMany(Action, { foreignKey: "menuId" });
  Action.belongsTo(Menu, { foreignKey: "menuId" });

  // Role ↔ menu/action grant cells.
  Role.hasMany(RoleMenuGrant, { foreignKey: "roleId" });
  RoleMenuGrant.belongsTo(Role, { foreignKey: "roleId" });
  RoleMenuGrant.belongsTo(Menu, { foreignKey: "menuId" });
  Role.hasMany(RoleActionGrant, { foreignKey: "roleId" });
  RoleActionGrant.belongsTo(Role, { foreignKey: "roleId" });
  RoleActionGrant.belongsTo(Action, { foreignKey: "actionId" });

  Organization.hasOne(Subscription, { foreignKey: "orgId" });
  Subscription.belongsTo(Organization, { foreignKey: "orgId" });

  // A framework type owns many framework families; a type with families cannot
  // be deleted (enforced in the service and by an ON DELETE RESTRICT FK).
  FrameworkType.hasMany(FrameworkFamily, { foreignKey: "frameworkTypeId" });
  FrameworkFamily.belongsTo(FrameworkType, { foreignKey: "frameworkTypeId" });

  // A framework family owns many frameworks; a family with frameworks cannot be
  // deleted (enforced in the service and by an ON DELETE RESTRICT FK).
  FrameworkFamily.hasMany(Framework, { foreignKey: "familyId" });
  Framework.belongsTo(FrameworkFamily, { foreignKey: "familyId" });

  // An organization may subscribe to many catalog frameworks; each subscription
  // row is unique per (org, framework). Deleting either side cascades the link.
  Organization.hasMany(OrganizationFramework, { foreignKey: "orgId" });
  OrganizationFramework.belongsTo(Organization, { foreignKey: "orgId" });
  Framework.hasMany(OrganizationFramework, { foreignKey: "frameworkId" });
  OrganizationFramework.belongsTo(Framework, { foreignKey: "frameworkId" });

  // Organization-scoped User Management entities. Each row belongs to one
  // organization; deleting the org cascades its profiles/accounts away (FK).
  Organization.hasMany(Profile, { foreignKey: "orgId" });
  Profile.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(Account, { foreignKey: "orgId" });
  Account.belongsTo(Organization, { foreignKey: "orgId" });

  Organization.hasMany(OrgSignatory, { foreignKey: "orgId" });
  OrgSignatory.belongsTo(Organization, { foreignKey: "orgId" });

  // A Distributor org has one commercial partner profile + one current agreement
  // (1:1 each via org_id). Deleting the org cascades both away (FK).
  Organization.hasOne(PartnerProfile, { foreignKey: "orgId" });
  PartnerProfile.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasOne(PartnerAgreement, { foreignKey: "orgId" });
  PartnerAgreement.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(AgreementTemplate, { foreignKey: "orgId" });
  AgreementTemplate.belongsTo(Organization, { foreignKey: "orgId" });
  AgreementTemplate.hasMany(PartnerAgreement, { foreignKey: "templateId" });
  PartnerAgreement.belongsTo(AgreementTemplate, { foreignKey: "templateId" });

  // A Tenant org has one profile + many sites/site-requests/framework-assignments.
  Organization.hasOne(TenantProfile, { foreignKey: "orgId" });
  TenantProfile.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(Site, { foreignKey: "orgId" });
  Site.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(SiteRequest, { foreignKey: "orgId" });
  SiteRequest.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(FrameworkAssignment, { foreignKey: "orgId" });
  FrameworkAssignment.belongsTo(Organization, { foreignKey: "orgId" });
  Site.hasMany(FrameworkAssignment, { foreignKey: "siteId" });
  FrameworkAssignment.belongsTo(Site, { foreignKey: "siteId" });
  Framework.hasMany(FrameworkAssignment, { foreignKey: "frameworkId" });
  FrameworkAssignment.belongsTo(Framework, { foreignKey: "frameworkId" });

  // Billing: an org has many invoices; invoices own payments + receipts.
  Organization.hasMany(Invoice, { foreignKey: "orgId" });
  Invoice.belongsTo(Organization, { foreignKey: "orgId" });
  Invoice.hasMany(Payment, { foreignKey: "invoiceId" });
  Payment.belongsTo(Invoice, { foreignKey: "invoiceId" });
  Invoice.hasMany(Receipt, { foreignKey: "invoiceId" });
  Receipt.belongsTo(Invoice, { foreignKey: "invoiceId" });
  Payment.hasOne(Receipt, { foreignKey: "paymentId" });
  Receipt.belongsTo(Payment, { foreignKey: "paymentId" });
  RevenueShareStatement.hasMany(Payout, { foreignKey: "statementId" });
  Payout.belongsTo(RevenueShareStatement, { foreignKey: "statementId" });

  Organization.hasMany(Ticket, { foreignKey: "orgId" });
  Ticket.belongsTo(Organization, { foreignKey: "orgId" });

  // Phase 7 meta-model.
  FrameworkGroup.hasMany(Framework, { foreignKey: "groupId" });
  Framework.belongsTo(FrameworkGroup, { foreignKey: "groupId" });
  Framework.hasMany(FrameworkRequirement, { foreignKey: "frameworkId" });
  FrameworkRequirement.belongsTo(Framework, { foreignKey: "frameworkId" });
  FrameworkRequirement.hasMany(RequirementCriterion, { foreignKey: "requirementId" });
  RequirementCriterion.belongsTo(FrameworkRequirement, { foreignKey: "requirementId" });
  // Element ↔ Requirement many-to-many through the xref join.
  FrameworkElement.belongsToMany(FrameworkRequirement, { through: ElementRequirementXref, foreignKey: "elementId", otherKey: "requirementId" });
  FrameworkRequirement.belongsToMany(FrameworkElement, { through: ElementRequirementXref, foreignKey: "requirementId", otherKey: "elementId" });
  FrameworkElement.hasMany(ElementRequirementXref, { foreignKey: "elementId" });
  ElementRequirementXref.belongsTo(FrameworkElement, { foreignKey: "elementId" });
  ElementRequirementXref.belongsTo(FrameworkRequirement, { foreignKey: "requirementId" });
  // Conformance Q&R + the rcmap criterion link.
  FrameworkElement.hasMany(ConformanceQuestion, { foreignKey: "elementId" });
  ConformanceQuestion.belongsTo(FrameworkElement, { foreignKey: "elementId" });
  ConformanceQuestion.hasMany(ConformanceResponse, { foreignKey: "questionId" });
  ConformanceResponse.belongsTo(ConformanceQuestion, { foreignKey: "questionId" });
  RequirementCriterion.hasMany(ConformanceResponse, { foreignKey: "criterionId" });
  ConformanceResponse.belongsTo(RequirementCriterion, { foreignKey: "criterionId" });

  // Phase 8 — tenant assessment run engine + gap analysis.
  Organization.hasMany(Assessment, { foreignKey: "orgId" });
  Assessment.belongsTo(Organization, { foreignKey: "orgId" });
  Site.hasMany(Assessment, { foreignKey: "siteId" });
  Assessment.belongsTo(Site, { foreignKey: "siteId" });
  Framework.hasMany(Assessment, { foreignKey: "frameworkId" });
  Assessment.belongsTo(Framework, { foreignKey: "frameworkId" });
  Assessment.hasMany(AssessmentAnswer, { foreignKey: "assessmentId" });
  AssessmentAnswer.belongsTo(Assessment, { foreignKey: "assessmentId" });
  ConformanceQuestion.hasMany(AssessmentAnswer, { foreignKey: "questionId" });
  AssessmentAnswer.belongsTo(ConformanceQuestion, { foreignKey: "questionId" });
  ConformanceResponse.hasMany(AssessmentAnswer, { foreignKey: "responseId" });
  AssessmentAnswer.belongsTo(ConformanceResponse, { foreignKey: "responseId" });
  Assessment.hasMany(Gap, { foreignKey: "assessmentId" });
  Gap.belongsTo(Assessment, { foreignKey: "assessmentId" });

  // Phase 9 — ISO clause registers (one shared table, org-scoped, FWE trace).
  Organization.hasMany(ImplementationRecord, { foreignKey: "orgId" });
  ImplementationRecord.belongsTo(Organization, { foreignKey: "orgId" });
  FrameworkElement.hasMany(ImplementationRecord, { foreignKey: "elementId" });
  ImplementationRecord.belongsTo(FrameworkElement, { foreignKey: "elementId" });

  initialized = true;
}

export {
  Organization,
  User,
  Role,
  Menu,
  Action,
  UserRole,
  RoleMenuGrant,
  RoleActionGrant,
  Subscription,
  RegistrationRequest,
  AuditLog,
  LoginHistory,
  RefreshToken,
  FrameworkType,
  FrameworkFamily,
  Framework,
  OrganizationFramework,
  Profile,
  Account,
  OrgSignatory,
  PartnerProfile,
  AgreementTemplate,
  PartnerAgreement,
  TenantProfile,
  Site,
  SiteRequest,
  FrameworkAssignment,
  Plan,
  Invoice,
  Payment,
  Receipt,
  RevenueShareStatement,
  Payout,
  Ticket,
  FrameworkGroup,
  FrameworkElement,
  FrameworkRequirement,
  RequirementCriterion,
  ElementRequirementXref,
  ConformanceQuestion,
  ConformanceResponse,
  Assessment,
  AssessmentAnswer,
  Gap,
  ImplementationRecord,
};
