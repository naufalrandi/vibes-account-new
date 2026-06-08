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
import { Framework } from "./framework.model";
import { Profile } from "./profile.model";
import { OrgSignatory } from "./orgSignatory.model";
import { Account } from "./account.model";
import { Site } from "./site.model";
import { SiteRequest } from "./siteRequest.model";
import { FrameworkAssignment } from "./frameworkAssignment.model";
import { KbArticle } from "./kbArticle.model";
import { Ticket } from "./ticket.model";
import { Notification } from "./notification.model";
import { ImplementationRecord } from "./implementationRecord.model";
import { BusinessRecord } from "./businessRecord.model";
import { AgreementTemplate } from "./agreementTemplate.model";
import { PartnerAgreement } from "./partnerAgreement.model";
import { Plan } from "./plan.model";
import { Invoice } from "./invoice.model";
import { FrameworkGroup } from "./frameworkGroup.model";
import { Requirement } from "./requirement.model";
import { Element } from "./element.model";
import { ElementRequirementMap } from "./elementRequirementMap.model";
import { Criterion } from "./criterion.model";
import { Question } from "./question.model";
import { Response as AssessmentResponse } from "./response.model";
import { ResponseCriterion } from "./responseCriterion.model";

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

  // A registration request is raised by a distributor org (its proposed tenant
  // is provisioned on approval). Linked for distributor-name display in lists.
  Organization.hasMany(RegistrationRequest, { foreignKey: "distributorOrgId" });
  RegistrationRequest.belongsTo(Organization, { foreignKey: "distributorOrgId" });

  // Organization-scoped User Management entities. Each row belongs to one
  // organization; deleting the org cascades its profiles/accounts away (FK).
  Organization.hasMany(Profile, { foreignKey: "orgId" });
  Profile.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(Account, { foreignKey: "orgId" });
  Account.belongsTo(Organization, { foreignKey: "orgId" });

  // An organization owns its authorized signatories; deleting the org cascades them.
  Organization.hasMany(OrgSignatory, { foreignKey: "orgId" });
  OrgSignatory.belongsTo(Organization, { foreignKey: "orgId" });

  // A partner (Distributor org) owns its generated agreement instances, each bound
  // to a template. Deleting the org cascades its agreements; the template is kept.
  Organization.hasMany(PartnerAgreement, { foreignKey: "orgId" });
  PartnerAgreement.belongsTo(Organization, { foreignKey: "orgId" });
  AgreementTemplate.hasMany(PartnerAgreement, { foreignKey: "agreementTemplateId" });
  PartnerAgreement.belongsTo(AgreementTemplate, { foreignKey: "agreementTemplateId" });

  // Billing: a tenant org has many invoices; a plan backs many subscriptions.
  Organization.hasMany(Invoice, { foreignKey: "orgId" });
  Invoice.belongsTo(Organization, { foreignKey: "orgId" });
  Plan.hasMany(Subscription, { foreignKey: "planId" });
  Subscription.belongsTo(Plan, { foreignKey: "planId" });

  // A tenant organization owns many sites; deleting the org cascades its sites
  // (FK). Site requests also belong to the tenant org and reference a site.
  Organization.hasMany(Site, { foreignKey: "orgId" });
  Site.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(SiteRequest, { foreignKey: "orgId" });
  SiteRequest.belongsTo(Organization, { foreignKey: "orgId" });
  Site.hasMany(SiteRequest, { foreignKey: "siteId" });
  SiteRequest.belongsTo(Site, { foreignKey: "siteId" });

  // A tenant org rolls out frameworks at its sites via framework assignments.
  // Deleting the org or site cascades its assignments; the framework master is
  // kept (RESTRICT). Each (site, framework) pair is unique (enforced in the DB).
  Organization.hasMany(FrameworkAssignment, { foreignKey: "orgId" });
  FrameworkAssignment.belongsTo(Organization, { foreignKey: "orgId" });
  Site.hasMany(FrameworkAssignment, { foreignKey: "siteId" });
  FrameworkAssignment.belongsTo(Site, { foreignKey: "siteId" });
  Framework.hasMany(FrameworkAssignment, { foreignKey: "frameworkId" });
  FrameworkAssignment.belongsTo(Framework, { foreignKey: "frameworkId" });

  // A support ticket belongs to the org that raised it; deleting the org cascades
  // its tickets (FK). KbArticle is platform-global master data — no association.
  Organization.hasMany(Ticket, { foreignKey: "orgId" });
  Ticket.belongsTo(Organization, { foreignKey: "orgId" });

  // In-app notifications target an org (nullable for platform-wide); deleting the
  // org cascades its notifications.
  Organization.hasMany(Notification, { foreignKey: "orgId" });
  Notification.belongsTo(Organization, { foreignKey: "orgId" });

  // A tenant owns its Implementation register records; deleting the org cascades them.
  Organization.hasMany(ImplementationRecord, { foreignKey: "orgId" });
  ImplementationRecord.belongsTo(Organization, { foreignKey: "orgId" });

  // Business Unit records belong to the Service Owner org (the operating company).
  Organization.hasMany(BusinessRecord, { foreignKey: "orgId" });
  BusinessRecord.belongsTo(Organization, { foreignKey: "orgId" });

  // === AXIA Framework & Assessment domain (Phase 1) ===
  // A framework belongs to a FrameworkGroup (Standards / Regulations).
  FrameworkGroup.hasMany(Framework, { foreignKey: "groupId" });
  Framework.belongsTo(FrameworkGroup, { foreignKey: "groupId" });

  // A framework owns its requirements (clauses/articles); deleting a framework
  // cascades them.
  Framework.hasMany(Requirement, { foreignKey: "frameworkId" });
  Requirement.belongsTo(Framework, { foreignKey: "frameworkId" });

  // Element ↔ Requirement many-to-many through the join.
  Requirement.hasMany(ElementRequirementMap, { foreignKey: "requirementId" });
  ElementRequirementMap.belongsTo(Requirement, { foreignKey: "requirementId" });
  Element.hasMany(ElementRequirementMap, { foreignKey: "elementId" });
  ElementRequirementMap.belongsTo(Element, { foreignKey: "elementId" });
  Requirement.belongsToMany(Element, { through: ElementRequirementMap, foreignKey: "requirementId", otherKey: "elementId" });
  Element.belongsToMany(Requirement, { through: ElementRequirementMap, foreignKey: "elementId", otherKey: "requirementId" });

  // A requirement defines maturity/compliance criteria (0–9 scores).
  Requirement.hasMany(Criterion, { foreignKey: "requirementId" });
  Criterion.belongsTo(Requirement, { foreignKey: "requirementId" });

  // Assessment: element → questions → responses → (one) criterion.
  Element.hasMany(Question, { foreignKey: "elementId" });
  Question.belongsTo(Element, { foreignKey: "elementId" });
  Question.hasMany(AssessmentResponse, { foreignKey: "questionId" });
  AssessmentResponse.belongsTo(Question, { foreignKey: "questionId" });
  AssessmentResponse.hasOne(ResponseCriterion, { foreignKey: "responseId" });
  ResponseCriterion.belongsTo(AssessmentResponse, { foreignKey: "responseId" });
  Criterion.hasMany(ResponseCriterion, { foreignKey: "criterionId" });
  ResponseCriterion.belongsTo(Criterion, { foreignKey: "criterionId" });

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
  Framework,
  Profile,
  OrgSignatory,
  Account,
  Site,
  SiteRequest,
  FrameworkAssignment,
  KbArticle,
  Ticket,
  Notification,
  ImplementationRecord,
  BusinessRecord,
  AgreementTemplate,
  PartnerAgreement,
  Plan,
  Invoice,
  FrameworkGroup,
  Requirement,
  Element,
  ElementRequirementMap,
  Criterion,
  Question,
  AssessmentResponse,
  ResponseCriterion,
};
