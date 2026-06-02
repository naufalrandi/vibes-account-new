import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestId } from "./middleware/requestId";
import { errorHandler } from "./middleware/error";
import { authRoutes } from "./modules/iam/auth.routes";
import { authenticate } from "./middleware/authenticate";
import { tenantScope } from "./middleware/tenantScope";
import { userRoutes } from "./modules/users/user.routes";
import { organizationRoutes } from "./modules/organizations/organization.routes";
import { registrationRoutes } from "./modules/organizations/registration.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { roleRoutes } from "./modules/iam/role.routes";
import { menuRoutes } from "./modules/menus/menu.routes";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestId);

  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" }, error: null, meta: null }));
  app.use("/v1/auth", authRoutes);
  app.use("/v1/users", authenticate, tenantScope, userRoutes);
  app.use("/v1/organizations", authenticate, tenantScope, organizationRoutes);
  app.use("/v1/registration-requests", authenticate, tenantScope, registrationRoutes);
  app.use("/v1/audit", authenticate, tenantScope, auditRoutes);
  app.use("/v1", authenticate, tenantScope, roleRoutes); // exposes /v1/roles and /v1/roles/:id/grants
  app.use("/v1/menu", authenticate, tenantScope, menuRoutes); // /v1/menu (current user's tree + access map)

  app.use(errorHandler);
  return app;
}
