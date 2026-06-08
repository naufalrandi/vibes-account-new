import { Router } from "express";
import * as c from "./element.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const elementRoutes = Router();
elementRoutes.get("/", requireAction(ACTIONS.ELEMENT_READ), c.list);
elementRoutes.get("/:id", requireAction(ACTIONS.ELEMENT_READ), c.get);
elementRoutes.post("/", requireAction(ACTIONS.ELEMENT_CREATE), c.create);
elementRoutes.put("/:id", requireAction(ACTIONS.ELEMENT_UPDATE), c.update);
elementRoutes.delete("/:id", requireAction(ACTIONS.ELEMENT_DELETE), c.remove);
elementRoutes.put("/:id/mappings", requireAction(ACTIONS.ELEMENT_MAPPING_MANAGE), c.setMappings);
