import { Router } from "express";
import * as c from "./siteRequest.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const siteRequestRoutes = Router();
siteRequestRoutes.get("/", requireAction(ACTIONS.SITE_REQUEST_READ), c.list);
siteRequestRoutes.post("/", requireAction(ACTIONS.SITE_REQUEST_CREATE), c.create);
siteRequestRoutes.get("/:id", requireAction(ACTIONS.SITE_REQUEST_READ), c.get);
siteRequestRoutes.post("/:id/review", requireAction(ACTIONS.SITE_REQUEST_DECIDE), c.review);
siteRequestRoutes.post("/:id/approve", requireAction(ACTIONS.SITE_REQUEST_DECIDE), c.approve);
siteRequestRoutes.post("/:id/reject", requireAction(ACTIONS.SITE_REQUEST_DECIDE), c.reject);
siteRequestRoutes.post("/:id/provision", requireAction(ACTIONS.SITE_REQUEST_DECIDE), c.provision);
