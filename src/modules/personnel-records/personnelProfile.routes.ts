import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createPersonnelProfile } from "../users/personnelAddProfile.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

/** List-level "Add Profile" flow (OD `personAddProfile`, 11 fields) — creates a new personnel record end to end. */
const addProfileSchema = z.object({
  orgId: z.string().uuid(),
  fullName: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  position: z.string().nullish(),
  phone: z.string().nullish(),
  workUnit: z.string().nullish(),
  siteId: z.string().uuid().nullish(),
  personnelType: z.string().nullish(),
  orgUnitId: z.string().uuid().nullish(),
  empLevel: z.string().nullish(),
});

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export const personnelProfileRoutes = Router();

personnelProfileRoutes.post(
  "/",
  requireAction(ACTIONS.PERSONNEL_PROFILE_CREATE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await createPersonnelProfile(guard(req), addProfileSchema.parse(req.body), req.ip ?? null);
      sendOk(res, user, 201);
    } catch (e) {
      next(e);
    }
  },
);
