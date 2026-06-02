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

  app.use(errorHandler);
  return app;
}
