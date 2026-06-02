import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Role } from "../../db/models";
import { sendOk } from "../../lib/apiResponse";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "./actions.catalog";
import { getRoleGrants, setRoleGrants } from "./role.service";
import { UnauthorizedError } from "../../lib/errors";

export const roleRoutes = Router();

const grantsSchema = z.object({
  menuIds: z.array(z.string().uuid()).default([]),
  actionKeys: z.array(z.string()).default([]),
});

roleRoutes.get("/roles", requireAction(ACTIONS.ROLE_READ), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendOk(res, await Role.findAll({ order: [["name", "ASC"]] }));
  } catch (e) {
    next(e);
  }
});

roleRoutes.get("/roles/:id/grants", requireAction(ACTIONS.ROLE_READ), async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendOk(res, await getRoleGrants(req.params.id as string));
  } catch (e) {
    next(e);
  }
});

roleRoutes.put("/roles/:id/grants", requireAction(ACTIONS.ROLE_GRANT), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { menuIds, actionKeys } = grantsSchema.parse(req.body);
    await setRoleGrants(req.params.id as string, menuIds, actionKeys, req.auth.userId, req.ip ?? null);
    sendOk(res, { updated: true });
  } catch (e) {
    next(e);
  }
});
