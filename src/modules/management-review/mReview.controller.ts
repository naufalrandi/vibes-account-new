import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./mReview.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
const statusSchema = z.object({ status: z.string().min(1).max(80) });
const actionSchema = z.object({
  title: z.string().optional(), desc: z.string().optional(), owner: z.string().optional(),
  due: z.string().nullish(), priority: z.string().optional(), status: z.string().optional(),
}).nullable().optional();
const recordSchema = z.object({
  topics: z.array(z.object({
    id: z.string().min(1),
    inputSummary: z.string().optional(),
    output: z.string().optional(),
    outputCategory: z.string().optional(),
    decisionStatus: z.string().optional(),
    itemStatus: z.string().optional(),
    action: actionSchema,
  })).min(1),
});

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const orgOf = (req: Request) => (typeof req.query.orgId === "string" ? req.query.orgId : undefined);
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

export const list = wrap(async (req, res) => ok(res, await service.listMReviews(guard(req), orgOf(req))));
export const get = wrap(async (req, res) => ok(res, await service.getMReview(guard(req), req.params.id as string)));
export const create = wrap(async (req, res) => ok(res, await service.createMReview(guard(req), body.parse(req.body), orgOf(req), ip(req)), 201));
export const update = wrap(async (req, res) => ok(res, await service.updateMReview(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setStatus = wrap(async (req, res) => ok(res, await service.setMReviewStatus(guard(req), req.params.id as string, statusSchema.parse(req.body).status, ip(req))));
export const record = wrap(async (req, res) => ok(res, await service.recordMReviewOutputs(guard(req), req.params.id as string, recordSchema.parse(req.body).topics, ip(req))));
