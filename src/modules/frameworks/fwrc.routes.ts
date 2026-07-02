import { Router } from "express";
import * as c from "./fwrc.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// FWRC hangs off requirements; reuse the requirement library guards.
export const fwrcRoutes = Router();
fwrcRoutes.get("/", requireAction(ACTIONS.REQUIREMENT_READ), c.list);
fwrcRoutes.post("/", requireAction(ACTIONS.REQUIREMENT_MANAGE), c.create);
fwrcRoutes.put("/:id", requireAction(ACTIONS.REQUIREMENT_MANAGE), c.update);
fwrcRoutes.delete("/:id", requireAction(ACTIONS.REQUIREMENT_MANAGE), c.remove);
