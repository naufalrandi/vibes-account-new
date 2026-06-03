import { Router } from "express";
import * as c from "./dashboard.controller";

// No requireAction guards — every authenticated user may view their own dashboard.
// Data is scoped server-side via req.auth.orgType in the service layer.
export const dashboardRoutes = Router();
dashboardRoutes.get("/stats", c.stats);
dashboardRoutes.get("/recent", c.recent);
