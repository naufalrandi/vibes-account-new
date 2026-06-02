import { Router } from "express";
import * as c from "./organization.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const organizationRoutes = Router();
organizationRoutes.get("/", requireAction(ACTIONS.ORG_READ), c.list);
organizationRoutes.get("/:id", requireAction(ACTIONS.ORG_READ), c.get);
organizationRoutes.post("/", requireAction(ACTIONS.ORG_CREATE), c.create);
organizationRoutes.post("/:id/activate", requireAction(ACTIONS.ORG_ACTIVATE), c.activate);
organizationRoutes.post("/:id/suspend", requireAction(ACTIONS.ORG_SUSPEND), c.suspend);
