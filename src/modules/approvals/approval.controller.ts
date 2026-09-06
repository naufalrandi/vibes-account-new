import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./approval.service";
import { sendOk } from "../../lib/apiResponse";
import { BadRequestError, UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
function guard(req: Request): AuthContext { if (!req.auth) throw new UnauthorizedError(); return req.auth; }
const ip = (req: Request) => req.ip ?? null;
const listMeta = (d: unknown[]) => ({ page: 1, limit: d.length, total: d.length });
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Schemes
export const listSchemes = wrap(async (req, res) => { const d = await service.listSchemes(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const createScheme = wrap(async (req, res) => sendOk(res, await service.createScheme(guard(req), body.parse(req.body), ip(req)), 201));
export const updateScheme = wrap(async (req, res) => sendOk(res, await service.updateScheme(guard(req), req.params.code as string, body.parse(req.body), ip(req))));
export const deleteScheme = wrap(async (req, res) => { await service.deleteScheme(guard(req), req.params.code as string, ip(req)); sendOk(res, { id: req.params.code }); });

// Module map
export const getModuleMap = wrap(async (req, res) => sendOk(res, await service.getModuleMap(guard(req))));
export const setModuleScheme = wrap(async (req, res) => { const b = z.object({ moduleKey: z.string().min(1).max(255), schemeId: z.string().min(1) }).parse(req.body); sendOk(res, await service.setModuleScheme(guard(req), b.moduleKey, b.schemeId, ip(req))); });

// Pools
export const listPoolMembers = wrap(async (req, res) => { const d = await service.listPoolMembers(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const setPoolMember = wrap(async (req, res) => sendOk(res, await service.setPoolMember(guard(req), req.params.userId as string, body.parse(req.body), ip(req))));

// Settings
export const getSettings = wrap(async (req, res) => sendOk(res, await service.getSettings(guard(req))));
export const setSettings = wrap(async (req, res) => { const b = z.object({ selfApprovalAllowed: z.boolean() }).parse(req.body); sendOk(res, await service.setSelfApproval(guard(req), b.selfApprovalAllowed, ip(req))); });

// Governed record workflow
const rec = (req: Request) => ({ module: req.params.module as string, recordId: req.params.recordId as string });
export const getRecord = wrap(async (req, res) => sendOk(res, await service.getApproval(guard(req), rec(req).module, rec(req).recordId)));
export const submit = wrap(async (req, res) => sendOk(res, await service.submit(guard(req), rec(req).module, rec(req).recordId, ip(req))));
export const approve = wrap(async (req, res) => sendOk(res, await service.approve(guard(req), rec(req).module, rec(req).recordId, ip(req))));
export const requestRevision = wrap(async (req, res) => {
  const b = z.object({ comments: z.string().max(4000).optional() }).parse(req.body ?? {});
  sendOk(res, await service.requestRevision(guard(req), rec(req).module, rec(req).recordId, ip(req), b.comments));
});
export const withdraw = wrap(async (req, res) => sendOk(res, await service.withdraw(guard(req), rec(req).module, rec(req).recordId, ip(req))));

// Controlled documents — OD's bespoke 3-step flow (review decision + explicit publish).
const documentsOnly = (req: Request) => {
  if (req.params.module !== "documents") {
    throw new BadRequestError("Only controlled documents use the review/publish flow", "MODULE_NOT_DOCUMENTS");
  }
};
export const review = wrap(async (req, res) => {
  documentsOnly(req);
  const b = z.object({
    decision: z.string().min(1).max(40),
    effectiveDate: z.string().max(40).nullish(),
    comments: z.string().max(4000).nullish(),
  }).parse(req.body ?? {});
  sendOk(res, await service.reviewDocument(guard(req), rec(req).recordId, b, ip(req)));
});
/* Two-stage document review — OD `cdReviewerSign`/`cdEscalate`/`cdPeriodicReview`. */
export const reviewerSign = wrap(async (req, res) => {
  documentsOnly(req);
  const b = z.object({
    comments: z.string().max(4000).nullish(),
    reviewer: z.string().max(200).nullish(),
    decision: z.enum(["Reviewed", "Request changes"]).optional(),
  }).parse(req.body ?? {});
  sendOk(res, await service.signAsReviewer(guard(req), rec(req).recordId, b.comments ?? null, ip(req), b.reviewer ?? null, b.decision ?? "Reviewed"));
});
export const escalateReview = wrap(async (req, res) => {
  documentsOnly(req);
  sendOk(res, await service.escalateReview(guard(req), rec(req).recordId, ip(req)));
});
export const periodicReview = wrap(async (req, res) => {
  documentsOnly(req);
  sendOk(res, await service.reconfirmPeriodicReview(guard(req), rec(req).recordId, ip(req)));
});

export const publish = wrap(async (req, res) => {
  documentsOnly(req);
  sendOk(res, await service.publishDocument(guard(req), rec(req).recordId, ip(req)));
});
