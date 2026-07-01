import { Router } from "express";
import * as c from "./element.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const elementRoutes = Router();
elementRoutes.get("/", requireAction(ACTIONS.ELEMENT_READ), c.list);
elementRoutes.get("/:id", requireAction(ACTIONS.ELEMENT_READ), c.get);
elementRoutes.post("/", requireAction(ACTIONS.ELEMENT_MANAGE), c.create);
elementRoutes.put("/:id", requireAction(ACTIONS.ELEMENT_MANAGE), c.update);
elementRoutes.put("/:id/mappings", requireAction(ACTIONS.ELEMENT_MANAGE), c.setMappings);
elementRoutes.delete("/:id", requireAction(ACTIONS.ELEMENT_MANAGE), c.remove);

// Element ↔ Requirement cross-reference (read-only, both directions).
export const xrefRoutes = Router();
xrefRoutes.get("/", requireAction(ACTIONS.ELEMENT_READ), c.crossReference);
