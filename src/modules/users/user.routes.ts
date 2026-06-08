import { Router } from "express";
import * as c from "./user.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const userRoutes = Router();
userRoutes.get("/", requireAction(ACTIONS.USER_READ), c.list);
userRoutes.post("/", requireAction(ACTIONS.USER_CREATE), c.create);
userRoutes.patch("/:id", requireAction(ACTIONS.USER_UPDATE), c.update);
userRoutes.post("/:id/resend-activation", requireAction(ACTIONS.USER_CREATE), c.resendActivation);
userRoutes.patch("/:id/status", requireAction(ACTIONS.USER_SUSPEND), c.setStatus);
// Delete is a soft-delete (status = "Deleted"); the row is retained for audit.
userRoutes.delete("/:id", requireAction(ACTIONS.USER_DELETE), c.softDelete);
userRoutes.post("/:id/roles", requireAction(ACTIONS.ROLE_ASSIGN), c.assignRole);
userRoutes.delete("/:id/roles/:roleId", requireAction(ACTIONS.ROLE_ASSIGN), c.removeRole);
