import { Router } from "express";
import * as c from "./kb.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const kbRoutes = Router();
// Categories are static display metadata; any KB reader may fetch them.
kbRoutes.get("/categories", requireAction(ACTIONS.KB_READ), c.categories);
kbRoutes.get("/", requireAction(ACTIONS.KB_READ), c.list);
kbRoutes.get("/:id", requireAction(ACTIONS.KB_READ), c.get);
kbRoutes.post("/", requireAction(ACTIONS.KB_CREATE), c.create);
kbRoutes.put("/:id", requireAction(ACTIONS.KB_UPDATE), c.update);
kbRoutes.post("/:id/publish", requireAction(ACTIONS.KB_PUBLISH), c.publish);
kbRoutes.post("/:id/archive", requireAction(ACTIONS.KB_ARCHIVE), c.archive);
// Feedback votes are allowed for any KB reader.
kbRoutes.post("/:id/vote", requireAction(ACTIONS.KB_READ), c.vote);
