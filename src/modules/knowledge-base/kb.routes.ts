import { Router } from "express";
import * as c from "./kb.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const kbRoutes = Router();
// `/categories` before `/:id` so the literal wins over the param.
kbRoutes.get("/categories", requireAction(ACTIONS.KB_READ), c.categories);
kbRoutes.get("/", requireAction(ACTIONS.KB_READ), c.list);
kbRoutes.post("/", requireAction(ACTIONS.KB_MANAGE), c.create);
kbRoutes.get("/:id", requireAction(ACTIONS.KB_READ), c.get);
kbRoutes.put("/:id", requireAction(ACTIONS.KB_MANAGE), c.update);
kbRoutes.delete("/:id", requireAction(ACTIONS.KB_MANAGE), c.remove);
kbRoutes.post("/:id/publish", requireAction(ACTIONS.KB_MANAGE), c.publish);
kbRoutes.post("/:id/archive", requireAction(ACTIONS.KB_MANAGE), c.archive);
kbRoutes.post("/:id/vote", requireAction(ACTIONS.KB_READ), c.vote);
