import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestId } from "./middleware/requestId";
import { errorHandler } from "./middleware/error";
import { authRoutes } from "./modules/iam/auth.routes";
import { authenticate } from "./middleware/authenticate";
import { tenantScope } from "./middleware/tenantScope";
import { rateLimit } from "./middleware/rateLimit";
import { env } from "./config/env";
import { userRoutes } from "./modules/users/user.routes";
import { organizationRoutes } from "./modules/organizations/organization.routes";
import { orgSettingsRoutes } from "./modules/organizations/orgSettings.routes";
import { registrationRoutes } from "./modules/organizations/registration.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { roleRoutes } from "./modules/iam/role.routes";
import { moduleRoutes } from "./modules/iam/modules.routes";
import { menuRoutes } from "./modules/menus/menu.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { frameworkTypeRoutes } from "./modules/frameworks/frameworkType.routes";
import { frameworkFamilyRoutes } from "./modules/frameworks/frameworkFamily.routes";
import { frameworkRoutes } from "./modules/frameworks/framework.routes";
import { frameworkCatalogRoutes } from "./modules/frameworks/frameworkCatalog.routes";
import { myFrameworkRoutes } from "./modules/frameworks/myFramework.routes";
import { profileRoutes } from "./modules/profiles/profile.routes";
import { accountRoutes } from "./modules/accounts/account.routes";
import { signatoryRoutes } from "./modules/signatories/signatory.routes";
import { partnerRoutes } from "./modules/partners/partner.routes";
import { agreementRoutes } from "./modules/agreements/agreement.routes";
import { tenantRoutes } from "./modules/tenants/tenant.routes";
import { siteRoutes } from "./modules/sites/site.routes";
import { siteRequestRoutes } from "./modules/site-requests/siteRequest.routes";
import { frameworkAssignmentRoutes } from "./modules/framework-assignments/frameworkAssignment.routes";
import { billingRoutes } from "./modules/billing/billing.routes";
import { ticketRoutes } from "./modules/tickets/ticket.routes";
import { frameworkGroupRoutes } from "./modules/frameworks/frameworkGroup.routes";
import { requirementRoutes, criteriaRoutes } from "./modules/frameworks/requirement.routes";
import { fwrcRoutes } from "./modules/frameworks/fwrc.routes";
import { elementRoutes, xrefRoutes } from "./modules/frameworks/element.routes";
import { assessmentRoutes } from "./modules/frameworks/assessment.routes";
import { assessmentRunRoutes } from "./modules/assessments/assessment.routes";
import { implementationRoutes } from "./modules/implementation/implementation.routes";
import { internalAuditRoutes } from "./modules/internal-audit/internalAudit.routes";
import { competenceRoutes } from "./modules/competence/competence.routes";
import { approvalRoutes } from "./modules/approvals/approval.routes";
import { scopeRoutes } from "./modules/scope/scope.routes";
import { workUnitRoutes } from "./modules/work-units/workUnit.routes";
import { roleRegisterRoutes } from "./modules/roles-register/roleRegister.routes";
import { recordEventRoutes } from "./modules/record-events/recordEvent.routes";
import { interestedPartyRoutes } from "./modules/interested-parties/ip.routes";
import { demoRoutes } from "./modules/demo/demo.routes";
import { demoPublicRoutes } from "./modules/demo/demoPublic.routes";
import { businessRoutes } from "./modules/business/business.routes";
import { businessDaysRoutes } from "./modules/business-days/businessDays.routes";
import { limsRoutes } from "./modules/lims/lims.routes";
import { kbRoutes } from "./modules/knowledge-base/kb.routes";
import { notificationRoutes } from "./modules/notifications/notification.routes";
import { referenceRoutes } from "./modules/reference/reference.routes";
import { referenceDbRoutes } from "./modules/reference-db/referenceDb.routes";
import { israLibraryRoutes as israThreatVulnLibraryRoutes } from "./modules/isra-threat-vuln-library/israLibrary.routes";
import { israOrgControlRoutes } from "./modules/isra-threat-vuln-library/israOrgControl.routes";
import { israRoutes } from "./modules/isra/isra.routes";
import { israAssetLibraryRoutes } from "./modules/isra/israAssetLibrary.routes";
import { riskRoutes } from "./modules/risks/risk.routes";

export function createApp() {
  const app = express();
  // Trust one proxy hop so `req.ip` (used by the rate limiter) reflects the real
  // client behind a single load balancer, not the proxy address.
  app.set("trust proxy", 1);
  app.use(helmet({ frameguard: { action: "deny" } }));
  // Restrict CORS to the configured frontend origin(s) — never reflect all origins.
  app.use(cors({ origin: env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()) }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestId);

  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" }, error: null, meta: null }));
  const authLimiter = rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
    keyPrefix: "auth",
  });
  app.use("/v1/auth", authLimiter, authRoutes);
  app.use("/v1/users", authenticate, tenantScope, userRoutes);
  app.use("/v1/organizations", authenticate, tenantScope, organizationRoutes);
  app.use("/v1/org-settings", authenticate, tenantScope, orgSettingsRoutes);
  app.use("/v1/registration-requests", authenticate, tenantScope, registrationRoutes);
  app.use("/v1/audit", authenticate, tenantScope, auditRoutes);
  app.use("/v1", authenticate, tenantScope, roleRoutes); // exposes /v1/roles and /v1/roles/:id/grants
  app.use("/v1/modules", authenticate, tenantScope, moduleRoutes); // permission-grid module catalog
  app.use("/v1/menu", authenticate, tenantScope, menuRoutes); // /v1/menu (current user's tree + access map)
  app.use("/v1/dashboard", authenticate, tenantScope, dashboardRoutes);
  app.use("/v1/framework-types", authenticate, tenantScope, frameworkTypeRoutes);
  app.use("/v1/framework-families", authenticate, tenantScope, frameworkFamilyRoutes);
  app.use("/v1/frameworks", authenticate, tenantScope, frameworkRoutes);
  app.use("/v1/framework-groups", authenticate, tenantScope, frameworkGroupRoutes);
  app.use("/v1/requirements", authenticate, tenantScope, requirementRoutes);
  app.use("/v1/criteria", authenticate, tenantScope, criteriaRoutes);
  app.use("/v1/fwrc", authenticate, tenantScope, fwrcRoutes);
  app.use("/v1/elements", authenticate, tenantScope, elementRoutes);
  app.use("/v1/framework-xref", authenticate, tenantScope, xrefRoutes);
  app.use("/v1/assessment", authenticate, tenantScope, assessmentRoutes);
  app.use("/v1/framework-catalog", authenticate, tenantScope, frameworkCatalogRoutes);
  app.use("/v1/my-frameworks", authenticate, tenantScope, myFrameworkRoutes);
  app.use("/v1/profiles", authenticate, tenantScope, profileRoutes);
  app.use("/v1/accounts", authenticate, tenantScope, accountRoutes);
  app.use("/v1/signatories", authenticate, tenantScope, signatoryRoutes);
  app.use("/v1/partners", authenticate, tenantScope, partnerRoutes);
  app.use("/v1/partnership-agreements", authenticate, tenantScope, agreementRoutes);
  app.use("/v1/tenants", authenticate, tenantScope, tenantRoutes);
  app.use("/v1/sites", authenticate, tenantScope, siteRoutes);
  app.use("/v1/site-requests", authenticate, tenantScope, siteRequestRoutes);
  app.use("/v1/framework-assignments", authenticate, tenantScope, frameworkAssignmentRoutes);
  app.use("/v1/billing", authenticate, tenantScope, billingRoutes);
  app.use("/v1/tickets", authenticate, tenantScope, ticketRoutes);
  app.use("/v1/assessments", authenticate, tenantScope, assessmentRunRoutes);
  app.use("/v1/implementation", authenticate, tenantScope, implementationRoutes);
  app.use("/v1/risks", authenticate, tenantScope, riskRoutes);
  app.use("/v1/internal-audit", authenticate, tenantScope, internalAuditRoutes);
  app.use("/v1/competence", authenticate, tenantScope, competenceRoutes);
  app.use("/v1/approvals", authenticate, tenantScope, approvalRoutes);
  app.use("/v1/scope", authenticate, tenantScope, scopeRoutes);
  app.use("/v1/work-units", authenticate, tenantScope, workUnitRoutes);
  app.use("/v1/org-roles", authenticate, tenantScope, roleRegisterRoutes);
  app.use("/v1/record-events", authenticate, tenantScope, recordEventRoutes);
  app.use("/v1/interested-parties", authenticate, tenantScope, interestedPartyRoutes);
  app.use("/v1/demo-tenants", authenticate, tenantScope, demoRoutes);
  // PUBLIC (no auth): landing/business-operations demo-request intake. Its own
  // per-IP rate limiter lives on the router (demoPublic.routes.ts).
  app.use("/v1/demo-requests", demoPublicRoutes);
  app.use("/v1/business", authenticate, tenantScope, businessRoutes);
  app.use("/v1/business-days", authenticate, tenantScope, businessDaysRoutes);
  app.use("/v1/lims", authenticate, tenantScope, limsRoutes);
  app.use("/v1/kb-articles", authenticate, tenantScope, kbRoutes);
  app.use("/v1/notifications", authenticate, tenantScope, notificationRoutes);
  app.use("/v1/reference", authenticate, tenantScope, referenceRoutes);
  app.use("/v1/reference-db", authenticate, tenantScope, referenceDbRoutes);
  // Each ISRA router owns exactly one prefix (P-6.2). The FE's three ISRA
  // path families map 1:1 to three routers:
  //  - /v1/isra-library/{annex-a-controls,threats,vulns,km/*,categories}  -> israThreatVulnLibraryRoutes
  //  - /v1/isra-asset-library/{primary,secondary}-assets                 -> israAssetLibraryRoutes
  //  - /v1/isra/{asset-maps,scenarios,soa,support,taxonomy,catalog,lt}   -> israRoutes (aggregator)
  // Previously israRoutes was ALSO mounted at /v1/isra-library (a harmless
  // dup, since its sub-paths never collided with israThreatVulnLibraryRoutes's)
  // and, worse, at /v1/isra-asset-library instead of the real
  // israAssetLibraryRoutes — so GET /v1/isra-asset-library/primary-assets
  // 404'd even though the FE calls it (fixed here).
  app.use("/v1/isra-library", authenticate, tenantScope, israThreatVulnLibraryRoutes);
  app.use("/v1/isra-org-controls", authenticate, tenantScope, israOrgControlRoutes);
  app.use("/v1/isra-asset-library", authenticate, tenantScope, israAssetLibraryRoutes);
  app.use("/v1/isra", authenticate, tenantScope, israRoutes);


  app.use(errorHandler);
  return app;
}
