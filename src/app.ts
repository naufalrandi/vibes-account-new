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
import { elementRoutes, xrefRoutes } from "./modules/frameworks/element.routes";
import { assessmentRoutes } from "./modules/frameworks/assessment.routes";
import { assessmentRunRoutes } from "./modules/assessments/assessment.routes";
import { implementationRoutes } from "./modules/implementation/implementation.routes";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
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
  app.use("/v1/menu", authenticate, tenantScope, menuRoutes); // /v1/menu (current user's tree + access map)
  app.use("/v1/dashboard", authenticate, tenantScope, dashboardRoutes);
  app.use("/v1/framework-types", authenticate, tenantScope, frameworkTypeRoutes);
  app.use("/v1/framework-families", authenticate, tenantScope, frameworkFamilyRoutes);
  app.use("/v1/frameworks", authenticate, tenantScope, frameworkRoutes);
  app.use("/v1/framework-groups", authenticate, tenantScope, frameworkGroupRoutes);
  app.use("/v1/requirements", authenticate, tenantScope, requirementRoutes);
  app.use("/v1/criteria", authenticate, tenantScope, criteriaRoutes);
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

  app.use(errorHandler);
  return app;
}
