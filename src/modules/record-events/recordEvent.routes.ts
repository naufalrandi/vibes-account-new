import { Router } from "express";
import * as c from "./recordEvent.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// Reuses the management-system register guards: readers see the timeline, managers comment.
export const recordEventRoutes = Router();
recordEventRoutes.get("/:module/:recordId", requireAction(ACTIONS.MS_READ), c.list);
recordEventRoutes.post("/:module/:recordId/comments", requireAction(ACTIONS.MS_MANAGE), c.comment);
