import { Router } from "express";
import * as c from "./orgSettings.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// The organization is always resolved from the auth context, so neither endpoint
// takes an id. Read requires the org.read grant; update requires org.update.
export const orgSettingsRoutes = Router();
orgSettingsRoutes.get("/", requireAction(ACTIONS.ORG_READ), c.getSettings);
orgSettingsRoutes.patch("/", requireAction(ACTIONS.ORG_UPDATE), c.updateSettings);
