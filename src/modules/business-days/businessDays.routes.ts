import { Router } from "express";
import * as c from "./businessDays.controller";

// No requireAction guard — a stateless computation utility (mirrors
// dashboardRoutes' "every authenticated user" precedent), not a
// business-record resource with its own permission grant.
export const businessDaysRoutes = Router();
businessDaysRoutes.post("/roll", c.roll);
