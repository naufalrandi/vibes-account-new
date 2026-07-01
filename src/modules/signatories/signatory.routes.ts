import { Router } from "express";
import * as c from "./signatory.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const signatoryRoutes = Router();
signatoryRoutes.get("/", requireAction(ACTIONS.SIGNATORY_READ), c.list);
signatoryRoutes.post("/", requireAction(ACTIONS.SIGNATORY_CREATE), c.create);
signatoryRoutes.put("/:id", requireAction(ACTIONS.SIGNATORY_UPDATE), c.update);
signatoryRoutes.post("/:id/toggle", requireAction(ACTIONS.SIGNATORY_UPDATE), c.toggle);
signatoryRoutes.delete("/:id", requireAction(ACTIONS.SIGNATORY_DELETE), c.remove);
