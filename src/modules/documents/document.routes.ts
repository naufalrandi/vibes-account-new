import { Router } from "express";
import * as c from "./document.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const documentRoutes = Router();

// `/folders` before `/:id` so the literal wins over the param.
documentRoutes.get("/folders", requireAction(ACTIONS.DOC_READ), c.listFolders);
documentRoutes.post("/folders", requireAction(ACTIONS.DOC_MANAGE), c.createFolder);
documentRoutes.patch("/folders/:id", requireAction(ACTIONS.DOC_MANAGE), c.updateFolder);
documentRoutes.delete("/folders/:id", requireAction(ACTIONS.DOC_MANAGE), c.removeFolder);

documentRoutes.get("/", requireAction(ACTIONS.DOC_READ), c.list);
documentRoutes.post("/", requireAction(ACTIONS.DOC_MANAGE), c.create);
documentRoutes.get("/:id", requireAction(ACTIONS.DOC_READ), c.get);
documentRoutes.patch("/:id", requireAction(ACTIONS.DOC_MANAGE), c.update);
documentRoutes.delete("/:id", requireAction(ACTIONS.DOC_MANAGE), c.remove);
documentRoutes.post("/:id/publish", requireAction(ACTIONS.DOC_MANAGE), c.publish);
documentRoutes.post("/:id/archive", requireAction(ACTIONS.DOC_MANAGE), c.archive);
