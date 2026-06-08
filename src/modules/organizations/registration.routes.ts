import { Router } from "express";
import * as c from "./registration.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const registrationRoutes = Router();
registrationRoutes.get("/", requireAction(ACTIONS.REGISTRATION_READ), c.list);
registrationRoutes.post("/", requireAction(ACTIONS.REGISTRATION_SUBMIT), c.submit);
registrationRoutes.post("/:id/approve", requireAction(ACTIONS.REGISTRATION_DECIDE), c.approve);
registrationRoutes.post("/:id/reject", requireAction(ACTIONS.REGISTRATION_DECIDE), c.reject);
