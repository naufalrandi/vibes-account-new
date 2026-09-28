import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sendOk } from "../../../lib/apiResponse";
import { UnauthorizedError } from "../../../lib/errors";
import * as svc from "./features.service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const usageQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), orgId: z.uuid().optional() });
const feedbackBody = z.object({ status: z.enum(["accepted", "edited", "rejected"]) });
const flagsQuery = z.object({ orgId: z.uuid().optional() });
const flagBody = z.object({ orgId: z.uuid().optional(), feature: z.string().min(1).max(60), enabled: z.boolean().nullable() });

type Handler = (req: Request & { auth: NonNullable<Request["auth"]> }, res: Response) => Promise<void>;

/** Auth check + error forwarding, once. */
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await fn(req as Parameters<Handler>[0], res);
  } catch (e) {
    next(e);
  }
};
const param = (req: Request, name: string) => String(req.params[name] ?? "");

export const listFeatures = handle(async (req, res) => sendOk(res, await svc.listForCaller(req.auth)));

export const invoke = handle(async (req, res) => {
  const out = await svc.invoke(req.auth, req.ip ?? null, param(req, "feature"), param(req, "action"), req.body);
  sendOk(res, out.body, out.status);
});

export const getJob = handle(async (req, res) => sendOk(res, await svc.getJob(req.auth, param(req, "id"))));

export const feedback = handle(async (req, res) =>
  sendOk(res, await svc.setFeedback(req.auth, param(req, "id"), feedbackBody.parse(req.body).status)),
);

export const usage = handle(async (req, res) => sendOk(res, await svc.usage(req.auth, usageQuery.parse(req.query))));

export const getFlags = handle(async (req, res) => sendOk(res, await svc.getFlags(req.auth, flagsQuery.parse(req.query).orgId)));

export const setFlag = handle(async (req, res) => sendOk(res, await svc.setFlag(req.auth, req.ip ?? null, flagBody.parse(req.body))));
