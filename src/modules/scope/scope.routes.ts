import { Router } from "express";
import * as c from "./scope.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.SCOPE_READ);
const manage = requireAction(ACTIONS.SCOPE_MANAGE);

export const scopeRoutes = Router();

// Scope datasets (env / ptype / dep master pick-lists)
scopeRoutes.get("/datasets", read, c.listDatasets);
scopeRoutes.post("/datasets", manage, c.createDataset);
scopeRoutes.put("/datasets/:id", manage, c.updateDataset);
scopeRoutes.delete("/datasets/:id", manage, c.deleteDataset);

// Management System Scope document
scopeRoutes.get("/scopes", read, c.listScopes);
// Draft-statement preview (OD `msGenStatement`) — read-only, persists nothing.
scopeRoutes.post("/scopes/generate-statement", read, c.generateStatement);
scopeRoutes.post("/scopes", manage, c.createScope);
scopeRoutes.get("/scopes/:id", read, c.getScope);
scopeRoutes.put("/scopes/:id", manage, c.updateScope);
scopeRoutes.post("/scopes/:id/approve", manage, c.approveScope);
scopeRoutes.post("/scopes/:id/activate", manage, c.activateScope);
scopeRoutes.post("/scopes/:id/archive", manage, c.archiveScope);
scopeRoutes.get("/scopes/:id/diff", read, c.scopeDiff);
scopeRoutes.post("/scopes/:id/submit-changes", manage, c.submitChanges);
scopeRoutes.post("/scopes/:id/partner-approve", manage, c.partnerApprove);
scopeRoutes.post("/scopes/:id/sp-approve", manage, c.spApprove);
scopeRoutes.post("/scopes/:id/reject-change", manage, c.rejectChange);
