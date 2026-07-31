import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import * as c from "./recordEvent.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * Record events are polymorphic across modules, so the grant required to read or
 * comment on a record has to follow the module the record belongs to. Gating the
 * whole router on the management-system actions meant a user holding only, say,
 * Interested-Parties grants could not see that module's own timeline.
 */
const MODULE_ACTIONS: Record<string, { read: string; manage: string }> = {
  "interested-parties": { read: ACTIONS.IP_READ, manage: ACTIONS.IP_MANAGE },
  scope: { read: ACTIONS.SCOPE_READ, manage: ACTIONS.SCOPE_MANAGE },
};

/** Defaults to the ISO clause registers, which every other module here is. */
function actionsFor(module: string): { read: string; manage: string } {
  return MODULE_ACTIONS[module] ?? { read: ACTIONS.MS_READ, manage: ACTIONS.MS_MANAGE };
}

function requireModuleAction(pick: (a: { read: string; manage: string }) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAction(pick(actionsFor(String(req.params.module))))(req, res, next);
  };
}

export const recordEventRoutes = Router();
recordEventRoutes.get("/:module/:recordId", requireModuleAction((a) => a.read), c.list);
recordEventRoutes.post("/:module/:recordId/comments", requireModuleAction((a) => a.manage), c.comment);
