import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./siteRequest.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import type { SiteRequestType, SiteRequestStatus } from "../../db/models/siteRequest.model";

const typeSchema = z.enum(["Site Addition", "Site Change", "Site Closure"]);
const statusSchema = z.enum(["Draft", "Submitted", "Under Review", "Approved", "Rejected", "Cancelled"]);
const proposedSchema = z.object({
  name: z.string().optional(),
  siteType: z.string().optional(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  isPrimary: z.boolean().optional(),
});

const createSchema = z.object({
  orgId: z.string().uuid(),
  type: typeSchema,
  siteId: z.string().uuid().nullish(),
  requestedBy: z.string().optional(),
  proposed: proposedSchema.optional(),
  reason: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const filters = {
      orgId: typeof req.query.orgId === "string" ? req.query.orgId : undefined,
      type: req.query.type as SiteRequestType | undefined,
      status: req.query.status as SiteRequestStatus | undefined,
    };
    const rows = await service.listSiteRequests(req.auth, filters);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getSiteRequest(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createSiteRequest(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

function action(fn: (auth: AuthContext, id: string, ip: string | null) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      sendOk(res, await fn(req.auth, req.params.id as string, req.ip ?? null));
    } catch (e) {
      next(e);
    }
  };
}

export const review = action(service.reviewSiteRequest);
export const approve = action(service.approveSiteRequest);
export const reject = action(service.rejectSiteRequest);
export const provision = action(service.provisionSiteRequest);
