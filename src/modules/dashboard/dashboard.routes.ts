import { Router } from "express";
import * as c from "./dashboard.controller";

export const dashboardRoutes = Router();
dashboardRoutes.get("/stats", c.stats);
dashboardRoutes.get("/recent", c.recent);
