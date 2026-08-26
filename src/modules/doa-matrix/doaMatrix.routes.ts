import { Router } from "express";
import * as c from "./doaMatrix.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// Reuses the approval domain's actions (delegation-of-authority is part of the
// approval/governance surface) rather than minting a new action key — see the
// SOF-58 final report for why (actions.catalog.ts carries unrelated
// in-flight edits this change avoids touching).
export const doaMatrixRoutes = Router();
doaMatrixRoutes.get("/", requireAction(ACTIONS.APPROVAL_READ), c.list);
doaMatrixRoutes.post("/", requireAction(ACTIONS.APPROVAL_MANAGE), c.create);
doaMatrixRoutes.put("/:id", requireAction(ACTIONS.APPROVAL_MANAGE), c.update);
doaMatrixRoutes.delete("/:id", requireAction(ACTIONS.APPROVAL_MANAGE), c.remove);
