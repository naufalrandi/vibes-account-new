import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as orgService from "./organization.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

// Partial-update schema for the Org Settings page. Unknown keys (notably `code`)
// are stripped by Zod, so the read-only organization code can never be changed
// through this endpoint. `name`, when provided, must be a non-empty string;
// `contactEmail`, when provided, must be a valid email.
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().nullish(),
  industry: z.string().nullish(),
  address: z.string().nullish(),
  contactName: z.string().nullish(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().nullish(),
});

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await orgService.getOrgSettings(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await orgService.updateOrgSettings(req.auth, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
