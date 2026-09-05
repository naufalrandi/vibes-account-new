import { Organization } from "./organization.model";
import { User } from "./user.model";
import { PersonnelProfile } from "./personnelProfile.model";
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
  ElementRequirementXref, ConformanceQuestion, ConformanceResponse, ElementAssessmentAnswer,
} from "./frameworkMeta.models";
import { Assessment, AssessmentAnswer, Gap } from "./assessment.models";
import { ImplementationRecord } from "./implementationRecord.model";
import { TestingService } from "./testingService.model";
import { KbArticle } from "./kbArticle.model";
import { Notification } from "./notification.model";
import { IaProgram, IaPlan, IaSession, IaFinding, IaReport, IaSettings } from "./internalAudit.models";
import { CompetenceEducation, CompetenceSkill, CompetenceTraining, CompetenceRole, CompetenceAssignment, CompetenceAssessment, CompetenceGap, CompetenceExamInstrument, CompetencePracticalInstrument, CompetenceExamAttempt, CompetencePracticalAttempt } from "./competence.models";
import { ApprovalScheme, ApprovalModuleMap, ApprovalPoolMember, ApprovalRecord, ApprovalSettings } from "./approval.models";
import { DocumentSettings } from "./documentSettings.model";
import { AwarenessSettings } from "./awarenessSettings.model";
import { CompetenceSettings } from "./competenceSettings.model";
import { ScopeDataset, MsScope } from "./scope.models";
import { IpParty, IpRequirement } from "./interestedParty.models";
import { DemoTenant } from "./demoTenant.model";
import { BusinessRecord } from "./businessRecord.model";
import { ReferenceSectorFramework, ReferenceIndustrySector, ReferenceEducationField, ReferenceEducationLevel, ReferenceCountry, ReferenceBank, ReferenceHoliday, ReferenceBpProcess, ReferenceFiscalConfig } from "./referenceDb.models";
import { WorkUnit } from "./workUnit.model";
import { RoleTemplate, RoleAssignment } from "./roleRegister.models";
import { RecordEvent } from "./recordEvent.model";
import { Fwrc } from "./fwrc.model";
import { IsraAnnexAControl, IsraThreatLibrary, IsraVulnLibrary, IsraPaGroup, IsraPaSubgroup, IsraSaGroup, IsraSaSubgroup } from "./israLibrary.models";
import { IsraPrimaryAssetLibrary, IsraSecondaryAssetLibrary, IsraKmSaThreat, IsraKmThreatVuln, IsraKmVulnControl, IsraKmMeta, IsraTreatTemplate } from "./israAssetLibrary.models";
import { IsraLibraryOverride, IsraLibraryItem, IsraLibraryArchive, IsraLibraryAudit } from "./israLibraryOverride.models";
import { IsraOrgControl, IsraControlMaturityBaseline, IsraVulnControlOverlay } from "./israOrgControl.models";
import { IsraAssetMap, IsraAssetMapUsage, IsraAssetMapSecondary, IsraAssetMapThreat, IsraAssetMapVuln } from "./israAssetMap.models";
import { IsraScenario, IsraScenarioVuln, IsraScenarioPotentialImpact, IsraExistingControl, IsraExistingControlAnnexRef, IsraScenarioCurrentRisk } from "./israScenario.models";
import { IsraScenarioTreatmentDecision, IsraScenarioRecommendationSnapshot, IsraScenarioRecommendationDisposition, IsraScenarioAddedControl, IsraRtp, IsraRtpAction, IsraRtpActionControl } from "./israTreatmentRtp.models";
import { IsraScenarioProjectedResidual, IsraScenarioActualResidual, IsraScenarioResidual, IsraScenarioClosure, IsraScenarioCycle, IsraInitiative, IsraInitiativeScenario, IsraAppetiteLog } from "./israResidualCycle.models";
import { IsraEvidence, IsraAudit, IsraScenarioTemplate, IsraSoaJustification, IsraOrgSettings } from "./israSupport.models";
import { SaasPipeline, SaasSubscription, SaasWorkspace } from "./saas.models";
import { PersonnelContractDocument, PersonnelActivityLog, PersonnelOnboardingItem, PersonnelCompensation } from "./personnelContractComp.models";
import { OrgUnit } from "./orgUnit.model";
import { PerfEval, MReview } from "./evaluation.models";
import { BusinessProcess, BusinessProcessStep } from "./businessProcess.models";
import { DocumentFolder, Document } from "./document.model";
import { CmsPage, CmsPost, CmsMedia, CmsMenuItem, CmsSettings } from "./cms.model";
import { ResumeRecord, LeaveRecord, DisciplinaryRecord, PerformanceRecord } from "./personnelRecords.models";
import { DoaMatrixEntry, DoaMethod } from "./doaMatrix.model";

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
  // SP self-assessment (OD `fwe-assess`) — one persisted answer per question, distinct
  // from the tenant-scoped Assessment/AssessmentAnswer run engine below.
  FrameworkElement.hasMany(ElementAssessmentAnswer, { foreignKey: "elementId" });
  ElementAssessmentAnswer.belongsTo(FrameworkElement, { foreignKey: "elementId" });
  ConformanceQuestion.hasOne(ElementAssessmentAnswer, { foreignKey: "questionId" });
  ElementAssessmentAnswer.belongsTo(ConformanceQuestion, { foreignKey: "questionId" });
  ConformanceResponse.hasMany(ElementAssessmentAnswer, { foreignKey: "responseId" });
  ElementAssessmentAnswer.belongsTo(ConformanceResponse, { foreignKey: "responseId" });

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

  // Phase 10 — LIMS testing services (tenant lab master data).
  Organization.hasMany(TestingService, { foreignKey: "orgId" });
  TestingService.belongsTo(Organization, { foreignKey: "orgId" });

  // Phase 11 — knowledge base + notifications.
  Organization.hasMany(KbArticle, { foreignKey: "orgId" });
  KbArticle.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(Notification, { foreignKey: "orgId" });
  Notification.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(Notification, { foreignKey: "userId" });
  Notification.belongsTo(User, { foreignKey: "userId" });

  // Internal Audit (ISO 9.2) — Program → Plan → Session → Finding + Report.
  Organization.hasMany(IaProgram, { foreignKey: "orgId" });
  IaProgram.belongsTo(Organization, { foreignKey: "orgId" });
  IaProgram.hasMany(IaPlan, { foreignKey: "programId" });
  IaPlan.belongsTo(IaProgram, { foreignKey: "programId" });
  IaProgram.hasMany(IaSession, { foreignKey: "programId" });
  IaPlan.hasMany(IaSession, { foreignKey: "planId" });
  IaSession.belongsTo(IaPlan, { foreignKey: "planId" });
  IaSession.belongsTo(IaProgram, { foreignKey: "programId" });
  IaProgram.hasMany(IaFinding, { foreignKey: "programId" });
  IaFinding.belongsTo(IaProgram, { foreignKey: "programId" });
  IaSession.hasMany(IaFinding, { foreignKey: "sessionId" });
  IaFinding.belongsTo(IaSession, { foreignKey: "sessionId" });
  IaProgram.hasMany(IaReport, { foreignKey: "programId" });
  IaReport.belongsTo(IaProgram, { foreignKey: "programId" });
  Organization.hasMany(IaSettings, { foreignKey: "orgId" });
  IaSettings.belongsTo(Organization, { foreignKey: "orgId" });

  // Competence libraries — training may be tenant-owned (nullable org = SP-global).
  Organization.hasMany(CompetenceTraining, { foreignKey: "orgId" });
  CompetenceTraining.belongsTo(Organization, { foreignKey: "orgId" });

  // Competence roles → assignments → assessments → gaps.
  CompetenceRole.hasMany(CompetenceAssignment, { foreignKey: "roleId" });
  CompetenceAssignment.belongsTo(CompetenceRole, { foreignKey: "roleId" });
  CompetenceAssignment.hasMany(CompetenceAssessment, { foreignKey: "assignmentId" });
  CompetenceAssessment.belongsTo(CompetenceAssignment, { foreignKey: "assignmentId" });
  CompetenceRole.belongsTo(CompetenceEducation, { foreignKey: "eduMinLevelId" });
  CompetenceAssignment.hasMany(CompetenceGap, { foreignKey: "assignmentId" });
  CompetenceGap.belongsTo(CompetenceAssignment, { foreignKey: "assignmentId" });
  CompetenceAssessment.hasMany(CompetenceGap, { foreignKey: "assessmentId" });

  // Competence instruments (exam ladder + L4 practical) and their attempts.
  CompetenceSkill.hasMany(CompetenceExamInstrument, { foreignKey: "skillId" });
  CompetenceExamInstrument.belongsTo(CompetenceSkill, { foreignKey: "skillId" });
  CompetenceSkill.hasMany(CompetencePracticalInstrument, { foreignKey: "skillId" });
  CompetencePracticalInstrument.belongsTo(CompetenceSkill, { foreignKey: "skillId" });
  CompetenceExamInstrument.hasMany(CompetenceExamAttempt, { foreignKey: "instrumentId" });
  CompetenceExamAttempt.belongsTo(CompetenceExamInstrument, { foreignKey: "instrumentId" });
  CompetencePracticalInstrument.hasMany(CompetencePracticalAttempt, { foreignKey: "instrumentId" });
  CompetencePracticalAttempt.belongsTo(CompetencePracticalInstrument, { foreignKey: "instrumentId" });

  // Approval engine.
  Organization.hasMany(ApprovalScheme, { foreignKey: "orgId" });
  ApprovalScheme.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(ApprovalPoolMember, { foreignKey: "orgId" });
  ApprovalPoolMember.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasOne(ApprovalPoolMember, { foreignKey: "userId" });
  ApprovalPoolMember.belongsTo(User, { foreignKey: "userId" });
  Organization.hasMany(ApprovalRecord, { foreignKey: "orgId" });
  ApprovalRecord.belongsTo(Organization, { foreignKey: "orgId" });

  // Interested parties → requirements.
  Organization.hasMany(IpParty, { foreignKey: "orgId" });
  IpParty.belongsTo(Organization, { foreignKey: "orgId" });
  IpParty.hasMany(IpRequirement, { foreignKey: "partyId" });
  IpRequirement.belongsTo(IpParty, { foreignKey: "partyId" });

  // Demo tenants → the real Organization/User generateDemoTenant() provisions.
  DemoTenant.belongsTo(Organization, { foreignKey: "provisionedOrgId", as: "provisionedOrg" });
  DemoTenant.belongsTo(User, { foreignKey: "provisionedUserId", as: "provisionedUser" });

  // ISRA + SoA (F-1-impl) — Group A: global taxonomy + library associations.
  IsraPaGroup.hasMany(IsraPaSubgroup, { foreignKey: "groupId" });
  IsraPaSubgroup.belongsTo(IsraPaGroup, { foreignKey: "groupId" });
  IsraSaGroup.hasMany(IsraSaSubgroup, { foreignKey: "groupId" });
  IsraSaSubgroup.belongsTo(IsraSaGroup, { foreignKey: "groupId" });
  IsraPaGroup.hasMany(IsraPrimaryAssetLibrary, { foreignKey: "groupId" });
  IsraPrimaryAssetLibrary.belongsTo(IsraPaGroup, { foreignKey: "groupId" });
  IsraPaSubgroup.hasMany(IsraPrimaryAssetLibrary, { foreignKey: "subgroupId" });
  IsraPrimaryAssetLibrary.belongsTo(IsraPaSubgroup, { foreignKey: "subgroupId" });
  IsraSaGroup.hasMany(IsraSecondaryAssetLibrary, { foreignKey: "groupId" });
  IsraSecondaryAssetLibrary.belongsTo(IsraSaGroup, { foreignKey: "groupId" });
  IsraSaSubgroup.hasMany(IsraSecondaryAssetLibrary, { foreignKey: "subgroupId" });
  IsraSecondaryAssetLibrary.belongsTo(IsraSaSubgroup, { foreignKey: "subgroupId" });
  // V2 knowledge maps (design doc §1.2) — SA-subgroup→Threat, Threat→Vuln.
  IsraSaSubgroup.hasMany(IsraKmSaThreat, { foreignKey: "subgroupId" });
  IsraKmSaThreat.belongsTo(IsraSaSubgroup, { foreignKey: "subgroupId" });
  IsraSaGroup.hasMany(IsraKmSaThreat, { foreignKey: "groupId" });
  IsraKmSaThreat.belongsTo(IsraSaGroup, { foreignKey: "groupId" });
  IsraThreatLibrary.hasMany(IsraKmSaThreat, { foreignKey: "threatId" });
  IsraKmSaThreat.belongsTo(IsraThreatLibrary, { foreignKey: "threatId" });
  IsraSaSubgroup.hasMany(IsraKmThreatVuln, { foreignKey: "subgroupId" });
  IsraKmThreatVuln.belongsTo(IsraSaSubgroup, { foreignKey: "subgroupId" });
  IsraSaGroup.hasMany(IsraKmThreatVuln, { foreignKey: "groupId" });
  IsraKmThreatVuln.belongsTo(IsraSaGroup, { foreignKey: "groupId" });
  IsraThreatLibrary.hasMany(IsraKmThreatVuln, { foreignKey: "threatId" });
  IsraKmThreatVuln.belongsTo(IsraThreatLibrary, { foreignKey: "threatId" });
  IsraVulnLibrary.hasMany(IsraKmThreatVuln, { foreignKey: "vulnId" });
  IsraKmThreatVuln.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });
  // Vuln→Annex A base map (design doc §1.3 — platform base, tenant overlay below).
  IsraVulnLibrary.hasMany(IsraKmVulnControl, { foreignKey: "vulnId" });
  IsraKmVulnControl.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });
  IsraAnnexAControl.hasMany(IsraKmVulnControl, { foreignKey: "annexRef" });
  IsraKmVulnControl.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  IsraVulnLibrary.hasMany(IsraTreatTemplate, { foreignKey: "vulnId" });
  IsraTreatTemplate.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });
  IsraAnnexAControl.hasMany(IsraTreatTemplate, { foreignKey: "annexRef" });
  IsraTreatTemplate.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });

  // ISRA — Group B: org-level library customization (the "Lt" system).
  Organization.hasMany(IsraLibraryOverride, { foreignKey: "orgId" });
  IsraLibraryOverride.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(IsraLibraryItem, { foreignKey: "orgId" });
  IsraLibraryItem.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(IsraLibraryArchive, { foreignKey: "orgId" });
  IsraLibraryArchive.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(IsraLibraryAudit, { foreignKey: "orgId" });
  IsraLibraryAudit.belongsTo(Organization, { foreignKey: "orgId" });

  // ISRA — Group C: org control customization + maturity baselines + the
  // Vuln→Annex A tenant overlay (design doc §1.3).
  Organization.hasMany(IsraOrgControl, { foreignKey: "orgId" });
  IsraOrgControl.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(IsraControlMaturityBaseline, { foreignKey: "orgId" });
  IsraControlMaturityBaseline.belongsTo(Organization, { foreignKey: "orgId" });
  IsraAnnexAControl.hasMany(IsraControlMaturityBaseline, { foreignKey: "annexRef" });
  IsraControlMaturityBaseline.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  Organization.hasMany(IsraVulnControlOverlay, { foreignKey: "orgId" });
  IsraVulnControlOverlay.belongsTo(Organization, { foreignKey: "orgId" });
  IsraKmVulnControl.hasMany(IsraVulnControlOverlay, { foreignKey: "edgeId" });
  IsraVulnControlOverlay.belongsTo(IsraKmVulnControl, { foreignKey: "edgeId" });
  IsraVulnLibrary.hasMany(IsraVulnControlOverlay, { foreignKey: "vulnId" });
  IsraVulnControlOverlay.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });
  IsraAnnexAControl.hasMany(IsraVulnControlOverlay, { foreignKey: "annexRef" });
  IsraVulnControlOverlay.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });

  // ISRA — Group D: the Asset Risk Mapping tree (design doc §2.6).
  Organization.hasMany(IsraAssetMap, { foreignKey: "orgId" });
  IsraAssetMap.belongsTo(Organization, { foreignKey: "orgId" });
  IsraAssetMap.hasMany(IsraAssetMapUsage, { foreignKey: "assetMapId" });
  IsraAssetMapUsage.belongsTo(IsraAssetMap, { foreignKey: "assetMapId" });
  IsraAssetMapUsage.hasMany(IsraAssetMapSecondary, { foreignKey: "usageId" });
  IsraAssetMapSecondary.belongsTo(IsraAssetMapUsage, { foreignKey: "usageId" });
  IsraAssetMapSecondary.hasMany(IsraAssetMapThreat, { foreignKey: "secondaryId" });
  IsraAssetMapThreat.belongsTo(IsraAssetMapSecondary, { foreignKey: "secondaryId" });
  IsraThreatLibrary.hasMany(IsraAssetMapThreat, { foreignKey: "threatId" });
  IsraAssetMapThreat.belongsTo(IsraThreatLibrary, { foreignKey: "threatId" });
  IsraAssetMapThreat.hasMany(IsraAssetMapVuln, { foreignKey: "threatRowId" });
  IsraAssetMapVuln.belongsTo(IsraAssetMapThreat, { foreignKey: "threatRowId" });
  IsraVulnLibrary.hasMany(IsraAssetMapVuln, { foreignKey: "vulnId" });
  IsraAssetMapVuln.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });

  // ISRA — Group E: Risk Register core (design doc §2.7). IsraScenario is the
  // anchor entity every later group hangs off.
  Organization.hasMany(IsraScenario, { foreignKey: "orgId" });
  IsraScenario.belongsTo(Organization, { foreignKey: "orgId" });
  IsraThreatLibrary.hasMany(IsraScenario, { foreignKey: "threatId" });
  IsraScenario.belongsTo(IsraThreatLibrary, { foreignKey: "threatId" });
  // includedVulns[] — junction with direct row access + belongsToMany convenience.
  IsraScenario.hasMany(IsraScenarioVuln, { foreignKey: "scenarioId" });
  IsraScenarioVuln.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraVulnLibrary.hasMany(IsraScenarioVuln, { foreignKey: "vulnId" });
  IsraScenarioVuln.belongsTo(IsraVulnLibrary, { foreignKey: "vulnId" });
  IsraScenario.belongsToMany(IsraVulnLibrary, { through: IsraScenarioVuln, foreignKey: "scenarioId", otherKey: "vulnId" });
  IsraVulnLibrary.belongsToMany(IsraScenario, { through: IsraScenarioVuln, foreignKey: "vulnId", otherKey: "scenarioId" });
  IsraScenario.hasMany(IsraScenarioPotentialImpact, { foreignKey: "scenarioId" });
  IsraScenarioPotentialImpact.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  Organization.hasMany(IsraExistingControl, { foreignKey: "orgId" });
  IsraExistingControl.belongsTo(Organization, { foreignKey: "orgId" });
  IsraScenario.hasMany(IsraExistingControl, { foreignKey: "scenarioId" });
  IsraExistingControl.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  // Existing Control ⇄ Annex A — M:N (design doc §2.1, feeds SoA).
  IsraExistingControl.hasMany(IsraExistingControlAnnexRef, { foreignKey: "existingControlId" });
  IsraExistingControlAnnexRef.belongsTo(IsraExistingControl, { foreignKey: "existingControlId" });
  IsraAnnexAControl.hasMany(IsraExistingControlAnnexRef, { foreignKey: "annexRef" });
  IsraExistingControlAnnexRef.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  IsraExistingControl.belongsToMany(IsraAnnexAControl, { through: IsraExistingControlAnnexRef, foreignKey: "existingControlId", otherKey: "annexRef" });
  IsraAnnexAControl.belongsToMany(IsraExistingControl, { through: IsraExistingControlAnnexRef, foreignKey: "annexRef", otherKey: "existingControlId" });
  IsraScenario.hasOne(IsraScenarioCurrentRisk, { foreignKey: "scenarioId" });
  IsraScenarioCurrentRisk.belongsTo(IsraScenario, { foreignKey: "scenarioId" });

  // ISRA — Group F part 1: Treatment, recommendations, added controls, RTP
  // (design doc §2.8 rows 1–7).
  IsraScenario.hasMany(IsraScenarioTreatmentDecision, { foreignKey: "scenarioId" });
  IsraScenarioTreatmentDecision.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasMany(IsraScenarioRecommendationSnapshot, { foreignKey: "scenarioId" });
  IsraScenarioRecommendationSnapshot.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasMany(IsraScenarioRecommendationDisposition, { foreignKey: "scenarioId" });
  IsraScenarioRecommendationDisposition.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraAnnexAControl.hasMany(IsraScenarioRecommendationDisposition, { foreignKey: "annexRef" });
  IsraScenarioRecommendationDisposition.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  IsraExistingControl.hasMany(IsraScenarioRecommendationDisposition, { foreignKey: "existingControlId" });
  IsraScenarioRecommendationDisposition.belongsTo(IsraExistingControl, { foreignKey: "existingControlId" });
  IsraScenario.hasMany(IsraScenarioAddedControl, { foreignKey: "scenarioId" });
  IsraScenarioAddedControl.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraAnnexAControl.hasMany(IsraScenarioAddedControl, { foreignKey: "annexRef" });
  IsraScenarioAddedControl.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  IsraScenario.hasMany(IsraRtp, { foreignKey: "scenarioId" });
  IsraRtp.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraRtp.hasMany(IsraRtpAction, { foreignKey: "rtpId" });
  IsraRtpAction.belongsTo(IsraRtp, { foreignKey: "rtpId" });
  // RTP Action ⇄ Annex A — M:N (design doc §2.1, SoA's third union term).
  IsraRtpAction.hasMany(IsraRtpActionControl, { foreignKey: "rtpActionId" });
  IsraRtpActionControl.belongsTo(IsraRtpAction, { foreignKey: "rtpActionId" });
  IsraAnnexAControl.hasMany(IsraRtpActionControl, { foreignKey: "annexRef" });
  IsraRtpActionControl.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  IsraRtpAction.belongsToMany(IsraAnnexAControl, { through: IsraRtpActionControl, foreignKey: "rtpActionId", otherKey: "annexRef" });
  IsraAnnexAControl.belongsToMany(IsraRtpAction, { through: IsraRtpActionControl, foreignKey: "annexRef", otherKey: "rtpActionId" });

  // ISRA — Group F part 2: Projected/Actual/rolling Residual + Closure (all
  // 1:1), Cycles, Initiatives, Appetite log (design doc §2.8 rows 8–15).
  IsraScenario.hasOne(IsraScenarioProjectedResidual, { foreignKey: "scenarioId" });
  IsraScenarioProjectedResidual.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasOne(IsraScenarioActualResidual, { foreignKey: "scenarioId" });
  IsraScenarioActualResidual.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasOne(IsraScenarioResidual, { foreignKey: "scenarioId" });
  IsraScenarioResidual.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasOne(IsraScenarioClosure, { foreignKey: "scenarioId" });
  IsraScenarioClosure.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraScenario.hasMany(IsraScenarioCycle, { foreignKey: "scenarioId" });
  IsraScenarioCycle.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  Organization.hasMany(IsraInitiative, { foreignKey: "orgId" });
  IsraInitiative.belongsTo(Organization, { foreignKey: "orgId" });
  IsraInitiative.hasMany(IsraInitiativeScenario, { foreignKey: "initiativeId" });
  IsraInitiativeScenario.belongsTo(IsraInitiative, { foreignKey: "initiativeId" });
  IsraScenario.hasMany(IsraInitiativeScenario, { foreignKey: "scenarioId" });
  IsraInitiativeScenario.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  IsraInitiative.belongsToMany(IsraScenario, { through: IsraInitiativeScenario, foreignKey: "initiativeId", otherKey: "scenarioId" });
  IsraScenario.belongsToMany(IsraInitiative, { through: IsraInitiativeScenario, foreignKey: "scenarioId", otherKey: "initiativeId" });
  Organization.hasMany(IsraAppetiteLog, { foreignKey: "orgId" });
  IsraAppetiteLog.belongsTo(Organization, { foreignKey: "orgId" });

  // ISRA — Group G: Evidence, general audit trail, scenario templates, SoA
  // justifications, consolidated org settings (design doc §2.9).
  Organization.hasMany(IsraEvidence, { foreignKey: "orgId" });
  IsraEvidence.belongsTo(Organization, { foreignKey: "orgId" });
  IsraScenario.hasMany(IsraEvidence, { foreignKey: "scenarioId" });
  IsraEvidence.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  Organization.hasMany(IsraAudit, { foreignKey: "orgId" });
  IsraAudit.belongsTo(Organization, { foreignKey: "orgId" });
  IsraScenario.hasMany(IsraAudit, { foreignKey: "scenarioId" });
  IsraAudit.belongsTo(IsraScenario, { foreignKey: "scenarioId" });
  Organization.hasMany(IsraScenarioTemplate, { foreignKey: "orgId" });
  IsraScenarioTemplate.belongsTo(Organization, { foreignKey: "orgId" });
  IsraThreatLibrary.hasMany(IsraScenarioTemplate, { foreignKey: "threatId" });
  IsraScenarioTemplate.belongsTo(IsraThreatLibrary, { foreignKey: "threatId" });
  Organization.hasMany(IsraSoaJustification, { foreignKey: "orgId" });
  IsraSoaJustification.belongsTo(Organization, { foreignKey: "orgId" });
  IsraAnnexAControl.hasMany(IsraSoaJustification, { foreignKey: "annexRef" });
  IsraSoaJustification.belongsTo(IsraAnnexAControl, { foreignKey: "annexRef" });
  Organization.hasOne(IsraOrgSettings, { foreignKey: "orgId" });
  IsraOrgSettings.belongsTo(Organization, { foreignKey: "orgId" });

  // A user has one personal/emergency-contact/employment sub-record
  // (ent-personnel Personal/Emergency/Employment tabs). Deleting the user
  // cascades the profile away (FK); a manager reference is a plain lookup,
  // not a delete-cascading association.
  User.hasOne(PersonnelProfile, { foreignKey: "userId" });
  PersonnelProfile.belongsTo(User, { foreignKey: "userId" });
  User.hasMany(PersonnelProfile, { foreignKey: "managerId", as: "ManagedPersonnelProfiles" });
  PersonnelProfile.belongsTo(User, { foreignKey: "managerId", as: "Manager" });

  // Personnel sub-record logs (SOF-53/SOF-48-3) — each scoped to a User (the
  // personnel record) and to the User's org for org-scoped listing.
  Organization.hasMany(ResumeRecord, { foreignKey: "orgId" });
  ResumeRecord.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(ResumeRecord, { foreignKey: "userId" });
  ResumeRecord.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(LeaveRecord, { foreignKey: "orgId" });
  LeaveRecord.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(LeaveRecord, { foreignKey: "userId" });
  LeaveRecord.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(DisciplinaryRecord, { foreignKey: "orgId" });
  DisciplinaryRecord.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(DisciplinaryRecord, { foreignKey: "userId" });
  DisciplinaryRecord.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(PerformanceRecord, { foreignKey: "orgId" });
  PerformanceRecord.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(PerformanceRecord, { foreignKey: "userId" });
  PerformanceRecord.belongsTo(User, { foreignKey: "userId" });
  // Aliased `reviewerUser`, not `reviewer`: OD's performance record carries a free-text
  // `reviewer` (js/modules.js:1080 stores 'Board', a governing body rather than a person),
  // which now exists as a real attribute — a `reviewer` association alias would collide
  // with it. The FK link is kept alongside for the cases where the reviewer IS a user.
  PerformanceRecord.belongsTo(User, { foreignKey: "reviewerId", as: "reviewerUser" });

  // Contract documents / activity log / onboarding checklist / comp+bank
  // binding (SOF-48-5) — all key off `users.id` directly, independent of
  // PersonnelProfile.
  Organization.hasMany(PersonnelContractDocument, { foreignKey: "orgId" });
  PersonnelContractDocument.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(PersonnelContractDocument, { foreignKey: "userId" });
  PersonnelContractDocument.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(PersonnelActivityLog, { foreignKey: "orgId" });
  PersonnelActivityLog.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(PersonnelActivityLog, { foreignKey: "userId" });
  PersonnelActivityLog.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(PersonnelOnboardingItem, { foreignKey: "orgId" });
  PersonnelOnboardingItem.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasMany(PersonnelOnboardingItem, { foreignKey: "userId" });
  PersonnelOnboardingItem.belongsTo(User, { foreignKey: "userId" });

  Organization.hasMany(PersonnelCompensation, { foreignKey: "orgId" });
  PersonnelCompensation.belongsTo(Organization, { foreignKey: "orgId" });
  User.hasOne(PersonnelCompensation, { foreignKey: "userId" });
  PersonnelCompensation.belongsTo(User, { foreignKey: "userId" });
  BusinessRecord.hasMany(PersonnelCompensation, { foreignKey: "compRecordId" });
  PersonnelCompensation.belongsTo(BusinessRecord, { foreignKey: "compRecordId", as: "compRecord" });

  // SOF-58 §3 — DOA (Delegation of Authority) spend-band matrix.
  Organization.hasMany(DoaMatrixEntry, { foreignKey: "orgId" });
  DoaMatrixEntry.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(DoaMethod, { foreignKey: "orgId" });
  DoaMethod.belongsTo(Organization, { foreignKey: "orgId" });

  // SOF-58 §4 — relations that already existed as bare FK columns but had no
  // registered Sequelize association, needed so the corresponding
  // `DESIGN_ONLY` parity notes point at a real, working relation.
  // A partner's tenants: TenantProfile.partnerOrgId -> the partner Organization.
  // Distinct from the existing Organization.hasOne(TenantProfile,{foreignKey:"orgId"})
  // (a tenant's own 1:1 profile) — same two tables, a second FK, so a second alias.
  Organization.hasMany(TenantProfile, { foreignKey: "partnerOrgId", as: "partnerTenants" });
  TenantProfile.belongsTo(Organization, { foreignKey: "partnerOrgId", as: "partnerOrg" });
  // A user's org unit (single-membership; OD's rarely-populated `units[]` array
  // was not adopted — see DESIGN_ONLY.units).
  OrgUnit.hasMany(User, { foreignKey: "orgUnitId" });
  User.belongsTo(OrgUnit, { foreignKey: "orgUnitId" });

  // SOF-58 §5/§6 — tenant/partner admin user link (design's `tenants.admin` /
  // `partners.admin`, constructed from a User row at creation time).
  TenantProfile.belongsTo(User, { foreignKey: "adminUserId", as: "admin" });
  PartnerProfile.belongsTo(User, { foreignKey: "adminUserId", as: "admin" });

  initialized = true;
}

export {
  Organization,
  User,
  PersonnelProfile,
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
  ElementAssessmentAnswer,
  Assessment,
  AssessmentAnswer,
  Gap,
  ImplementationRecord,
  TestingService,
  KbArticle,
  Notification,
  IaProgram,
  IaPlan,
  IaSession,
  IaFinding,
  IaReport,
  IaSettings,
  CompetenceEducation,
  CompetenceSkill,
  CompetenceTraining,
  CompetenceRole,
  CompetenceAssignment,
  CompetenceAssessment,
  CompetenceGap,
  CompetenceExamInstrument,
  CompetencePracticalInstrument,
  CompetenceExamAttempt,
  CompetencePracticalAttempt,
  ApprovalScheme,
  ApprovalModuleMap,
  ApprovalPoolMember,
  ApprovalRecord,
  ApprovalSettings,
  DocumentSettings,
  AwarenessSettings,
  CompetenceSettings,
  ScopeDataset,
  MsScope,
  IpParty,
  IpRequirement,
  DemoTenant,
  BusinessRecord,
  WorkUnit,
  RoleTemplate,
  RoleAssignment,
  RecordEvent,
  Fwrc,
  ReferenceSectorFramework,
  ReferenceIndustrySector,
  ReferenceEducationField,
  ReferenceEducationLevel,
  ReferenceCountry,
  IsraAnnexAControl,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraPaGroup,
  IsraPaSubgroup,
  IsraSaGroup,
  IsraSaSubgroup,
  IsraPrimaryAssetLibrary,
  IsraSecondaryAssetLibrary,
  IsraKmSaThreat,
  IsraKmThreatVuln,
  IsraKmVulnControl,
  IsraKmMeta,
  IsraTreatTemplate,
  IsraLibraryOverride,
  IsraLibraryItem,
  IsraLibraryArchive,
  IsraLibraryAudit,
  IsraOrgControl,
  IsraControlMaturityBaseline,
  IsraVulnControlOverlay,
  IsraAssetMap,
  IsraAssetMapUsage,
  IsraAssetMapSecondary,
  IsraAssetMapThreat,
  IsraAssetMapVuln,
  IsraScenario,
  IsraScenarioVuln,
  IsraScenarioPotentialImpact,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
  IsraScenarioCurrentRisk,
  IsraScenarioTreatmentDecision,
  IsraScenarioRecommendationSnapshot,
  IsraScenarioRecommendationDisposition,
  IsraScenarioAddedControl,
  IsraRtp,
  IsraRtpAction,
  IsraRtpActionControl,
  IsraScenarioProjectedResidual,
  IsraScenarioActualResidual,
  IsraScenarioResidual,
  IsraScenarioClosure,
  IsraScenarioCycle,
  IsraInitiative,
  IsraInitiativeScenario,
  IsraAppetiteLog,
  IsraEvidence,
  IsraAudit,
  IsraScenarioTemplate,
  IsraSoaJustification,
  IsraOrgSettings,
  SaasPipeline,
  SaasSubscription,
  SaasWorkspace,
  OrgUnit,
  PerfEval,
  MReview,
  BusinessProcess,
  BusinessProcessStep,
  DocumentFolder,
  Document,
  CmsPage,
  CmsPost,
  CmsMedia,
  CmsMenuItem,
  CmsSettings,
  ResumeRecord,
  LeaveRecord,
  DisciplinaryRecord,
  PerformanceRecord,
  PersonnelContractDocument,
  PersonnelActivityLog,
  PersonnelOnboardingItem,
  PersonnelCompensation,
  DoaMatrixEntry,
  DoaMethod,
  ReferenceBank,
  ReferenceHoliday,
  ReferenceBpProcess,
  ReferenceFiscalConfig,
};
