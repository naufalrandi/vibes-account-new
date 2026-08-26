import { Router } from "express";
import * as c from "./orgUnit.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const orgUnitRoutes = Router();
orgUnitRoutes.get("/", requireAction(ACTIONS.ORGUNIT_READ), c.list);
orgUnitRoutes.post("/", requireAction(ACTIONS.ORGUNIT_MANAGE), c.create);
orgUnitRoutes.put("/:id", requireAction(ACTIONS.ORGUNIT_MANAGE), c.update);
orgUnitRoutes.delete("/:id", requireAction(ACTIONS.ORGUNIT_MANAGE), c.remove);
orgUnitRoutes.get("/:id/members", requireAction(ACTIONS.ORGUNIT_READ), c.members);
orgUnitRoutes.post("/:id/reparent", requireAction(ACTIONS.ORGUNIT_MANAGE), c.reparent);
