import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./assessment.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const createSchema = z.object({
  orgId: z.string().uuid().optional(),
  siteId: z.string().uuid().nullish(),
  frameworkId: z.string().uuid().nullish(),
  title: z.string().max(200).optional(),
});

const answersSchema = z.object({
  answers: z.record(z.string().uuid(), z.string().uuid()),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const rows = await service.listAssessments(req.auth, { orgId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getAssessment(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createAssessment(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function answers(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = answersSchema.parse(req.body);
    sendOk(res, await service.submitAnswers(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function finalize(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.finalizeAssessment(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function results(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getResults(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function gaps(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.listGaps(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function reassess(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.reassess(req.auth, req.params.id as string, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}
