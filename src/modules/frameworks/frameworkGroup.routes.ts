import { Router } from "express";
import * as c from "./framework.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkGroupRoutes = Router();
frameworkGroupRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_READ), c.groups);
