import { Router } from "express";
import * as c from "./demo.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const demoRoutes = Router();
demoRoutes.get("/", requireAction(ACTIONS.DEMO_READ), c.list);
demoRoutes.post("/", requireAction(ACTIONS.DEMO_CREATE), c.create);
demoRoutes.get("/:id", requireAction(ACTIONS.DEMO_READ), c.get);
demoRoutes.post("/:id/approve", requireAction(ACTIONS.DEMO_MANAGE), c.approve);
demoRoutes.post("/:id/reject", requireAction(ACTIONS.DEMO_MANAGE), c.reject);
demoRoutes.post("/:id/generate", requireAction(ACTIONS.DEMO_MANAGE), c.generate);
demoRoutes.post("/:id/resend", requireAction(ACTIONS.DEMO_MANAGE), c.resend);
demoRoutes.post("/:id/extend", requireAction(ACTIONS.DEMO_MANAGE), c.extend);
demoRoutes.post("/:id/disable", requireAction(ACTIONS.DEMO_MANAGE), c.disable);
demoRoutes.post("/:id/delete", requireAction(ACTIONS.DEMO_MANAGE), c.remove);
