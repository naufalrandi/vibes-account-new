import { Router } from "express";
import * as c from "./registration.controller";
import { requireAction, requireAnyAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const registrationRoutes = Router();
// Both sides of the workflow read this queue: the partner who raises requests
// and the Service Owner who decides them. listRegistrations() already scopes a
// partner to its own requests and returns nothing for a tenant.
registrationRoutes.get("/", requireAnyAction(ACTIONS.REGISTRATION_SUBMIT, ACTIONS.REGISTRATION_DECIDE), c.list);
registrationRoutes.post("/", requireAction(ACTIONS.REGISTRATION_SUBMIT), c.submit);
// Editing and moving a request along the lifecycle is available to whoever
// raised it (a partner for its own, or the Service Owner for a Direct request).
registrationRoutes.put("/:id", requireAction(ACTIONS.REGISTRATION_SUBMIT), c.update);
registrationRoutes.post("/:id/transition", requireAction(ACTIONS.REGISTRATION_SUBMIT), c.transition);
registrationRoutes.post("/:id/approve", requireAction(ACTIONS.REGISTRATION_DECIDE), c.approve);
registrationRoutes.post("/:id/reject", requireAction(ACTIONS.REGISTRATION_DECIDE), c.reject);
