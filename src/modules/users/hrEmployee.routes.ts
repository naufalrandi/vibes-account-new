import { Router } from "express";
import * as c from "./hrEmployee.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const hrEmployeeRoutes = Router();
// Same grant as the team list — this is the unprovisioned half of the same roster.
hrEmployeeRoutes.get("/", requireAction(ACTIONS.USER_READ), c.list);
