import { Router } from "express";
import * as c from "./workUnit.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const workUnitRoutes = Router();
workUnitRoutes.get("/", requireAction(ACTIONS.WORKUNIT_READ), c.list);
workUnitRoutes.post("/", requireAction(ACTIONS.WORKUNIT_MANAGE), c.create);
workUnitRoutes.put("/:id", requireAction(ACTIONS.WORKUNIT_MANAGE), c.update);
workUnitRoutes.post("/:id/archive", requireAction(ACTIONS.WORKUNIT_MANAGE), c.archive);
