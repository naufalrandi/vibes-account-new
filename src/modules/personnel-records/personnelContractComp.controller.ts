import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as contractDocs from "../users/personnelContractDoc.service";
import * as activity from "../users/personnelActivity.service";
import * as onboarding from "../users/personnelOnboarding.service";
import * as compensation from "../users/personnelCompensation.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };

const contractDocSchema = z.object({
  title: z.string().min(1).optional(),
  docType: z.string().nullish(),
  status: z.enum(["Draft", "Final", "Signed", "Expired", "Issued"]).optional(),
  content: z.string().nullish(),
  effectiveDate: z.string().nullish(),
  expiryDate: z.string().nullish(),
  typeId: z.string().uuid().nullish(),
  country: z.string().nullish(),
  templateId: z.string().uuid().nullish(),
  clauses: z
    .array(
      z.object({
        title: z.string(),
        category: z.string(),
        body: z.string(),
        origTitle: z.string().optional(),
        origBody: z.string().optional(),
        sourceId: z.string(),
        edited: z.boolean(),
        include: z.boolean(),
      }),
    )
    .optional(),
});

export const listContractDocs = wrap(async (req, res) =>
  ok(res, await contractDocs.listContractDocuments(guard(req), req.params.userId as string)),
);
export const createContractDoc = wrap(async (req, res) =>
  ok(res, await contractDocs.createContractDocument(guard(req), req.params.userId as string, contractDocSchema.parse(req.body)), 201),
);
export const updateContractDoc = wrap(async (req, res) =>
  ok(
    res,
    await contractDocs.updateContractDocument(
      guard(req),
      req.params.userId as string,
      req.params.docId as string,
      contractDocSchema.parse(req.body),
    ),
  ),
);
export const signContractDoc = wrap(async (req, res) =>
  ok(res, await contractDocs.signContractDocument(guard(req), req.params.userId as string, req.params.docId as string)),
);
export const issueContractDoc = wrap(async (req, res) =>
  ok(res, await contractDocs.issueContractDocument(guard(req), req.params.userId as string, req.params.docId as string)),
);

export const listActivity = wrap(async (req, res) => ok(res, await activity.listPersonnelActivity(guard(req), req.params.userId as string)));

const activitySchema = z.object({ action: z.string().min(1), detail: z.string().nullish() });
export const addActivity = wrap(async (req, res) => {
  const body = activitySchema.parse(req.body);
  await activity.addPersonnelActivity(guard(req), req.params.userId as string, body.action, body.detail);
  ok(res, await activity.listPersonnelActivity(guard(req), req.params.userId as string), 201);
});

export const listOnboarding = wrap(async (req, res) => ok(res, await onboarding.listOnboardingItems(guard(req), req.params.userId as string)));

const onboardingItemSchema = z.object({ label: z.string().min(1) });
export const addOnboardingItem = wrap(async (req, res) =>
  ok(res, await onboarding.addOnboardingItem(guard(req), req.params.userId as string, onboardingItemSchema.parse(req.body).label), 201),
);

const onboardingDoneSchema = z.object({ done: z.boolean() });
export const setOnboardingDone = wrap(async (req, res) =>
  ok(
    res,
    await onboarding.setOnboardingItemDone(
      guard(req),
      req.params.userId as string,
      req.params.itemId as string,
      onboardingDoneSchema.parse(req.body).done,
    ),
  ),
);

export const getCompensation = wrap(async (req, res) => ok(res, await compensation.getCompensation(guard(req), req.params.userId as string)));

const compensationSchema = z.object({
  compRecordId: z.string().uuid().nullish(),
  bankName: z.string().nullish(),
  bankAccountNo: z.string().nullish(),
  bankAccountName: z.string().nullish(),
  taxId: z.string().nullish(),
  taxStatus: z.string().nullish(),
  effectiveDate: z.string().nullish(),
  minwageRecordId: z.string().uuid().nullish(),
});
export const updateCompensation = wrap(async (req, res) =>
  ok(res, await compensation.updateCompensation(guard(req), req.params.userId as string, compensationSchema.parse(req.body))),
);
export const minwageCheck = wrap(async (req, res) => ok(res, await compensation.checkMinWageCompliance(guard(req), req.params.userId as string)));
