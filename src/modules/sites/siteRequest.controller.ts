import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./siteRequest.service";
import type { SiteRequestStatus, SiteRequestType } from "../../db/models/siteRequest.model";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const proposedSchema = z.object({
  name: z.string().optional(),
  siteType: z.string().optional(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  isPrimary: z.boolean().optional(),
});

const createSchema = z.object({
  orgId: z.string().uuid(),
  type: z.enum(["Site Addition", "Site Change", "Site Closure"]),
  siteId: z.string().uuid().nullish(),
  requestedBy: z.string().optional(),
  proposed: proposedSchema.optional(),
  reason: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const type = typeof req.query.type === "string" ? (req.query.type as SiteRequestType) : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as SiteRequestStatus) : undefined;
    const rows = await service.listSiteRequests(req.auth, { orgId, type, status });
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

export async function review(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.reviewSiteRequest(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.approveSiteRequest(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.rejectSiteRequest(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.provisionSiteRequest(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
