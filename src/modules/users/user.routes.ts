import { Router } from "express";
import * as c from "./user.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const userRoutes = Router();
userRoutes.get("/", requireAction(ACTIONS.USER_READ), c.list);
userRoutes.post("/", requireAction(ACTIONS.USER_CREATE), c.create);
userRoutes.patch("/:id/status", requireAction(ACTIONS.USER_SUSPEND), c.setStatus);
userRoutes.delete("/:id", requireAction(ACTIONS.USER_DELETE), c.remove);
userRoutes.post("/:id/roles", requireAction(ACTIONS.ROLE_ASSIGN), c.assignRole);
userRoutes.delete("/:id/roles/:roleId", requireAction(ACTIONS.ROLE_ASSIGN), c.removeRole);
