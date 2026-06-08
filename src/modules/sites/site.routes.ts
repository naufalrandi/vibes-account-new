import { Router } from "express";
import * as c from "./site.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const siteRoutes = Router();
siteRoutes.get("/", requireAction(ACTIONS.SITE_READ), c.list);
siteRoutes.get("/:id", requireAction(ACTIONS.SITE_READ), c.get);
siteRoutes.post("/", requireAction(ACTIONS.SITE_CREATE), c.create);
siteRoutes.put("/:id", requireAction(ACTIONS.SITE_UPDATE), c.update);
siteRoutes.delete("/:id", requireAction(ACTIONS.SITE_DELETE), c.remove);
