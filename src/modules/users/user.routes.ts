import { Router } from "express";
import * as c from "./user.controller";
import * as pc from "./personnelProfile.controller";
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

// Personnel record sub-data (OD ent-personnel Personal/Emergency/Employment
// tabs, SOF-48-1). Same USER_READ/USER_UPDATE grants as the rest of the user
// record — this is just more fields on the same managed entity.
userRoutes.get("/:id/personnel-profile", requireAction(ACTIONS.USER_READ), pc.get);
userRoutes.patch("/:id/personnel-profile/personal", requireAction(ACTIONS.USER_UPDATE), pc.updatePersonal);
userRoutes.patch("/:id/personnel-profile/emergency", requireAction(ACTIONS.USER_UPDATE), pc.updateEmergency);
userRoutes.patch("/:id/personnel-profile/employment", requireAction(ACTIONS.USER_UPDATE), pc.updateEmployment);
userRoutes.post("/:id/personnel-profile/employment/renew", requireAction(ACTIONS.USER_UPDATE), pc.renew);
userRoutes.post("/:id/personnel-profile/employment/convert", requireAction(ACTIONS.USER_UPDATE), pc.convert);
userRoutes.post(
  "/:id/personnel-profile/employment/confirm-probation",
  requireAction(ACTIONS.USER_UPDATE),
  pc.confirmProbation,
);
