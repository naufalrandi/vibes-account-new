import { Router } from "express";
import * as c from "./profile.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const profileRoutes = Router();
profileRoutes.get("/", requireAction(ACTIONS.PROFILE_READ), c.list);
profileRoutes.post("/", requireAction(ACTIONS.PROFILE_CREATE), c.create);
profileRoutes.put("/:id", requireAction(ACTIONS.PROFILE_UPDATE), c.update);
profileRoutes.delete("/:id", requireAction(ACTIONS.PROFILE_DELETE), c.remove);
