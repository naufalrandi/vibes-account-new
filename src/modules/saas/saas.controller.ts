import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./saas.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const guard = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

const createPipelineSchema = z.object({
  tenantName: z.string().min(1),
  partnerId: z.string().uuid().nullish(),
  industry: z.string().nullish(),
  country: z.string().min(1).optional(),
  contactPerson: z.string().nullish(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().nullish(),
  items: z.array(z.unknown()).min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1).optional(),
});

const saveRegistrationSchema = z.object({
  legalName: z.string().min(1),
  industry: z.string().nullish(),
  country: z.string().optional(),
  address: z.string().nullish(),
  taxId: z.string().nullish(),
  siteName: z.string().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminUser: z.string().optional(),
  billingEmail: z.string().nullish(),
  termsAccepted: z.boolean(),
});

const uploadProofSchema = z.object({
  proofUrl: z.string().nullish(),
});

function listHandler<T>(fn: () => Promise<T[]>) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await fn();
      sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
    } catch (e) {
      next(e);
    }
  };
}

export const listPipeline = listHandler(service.listPipeline);
export const listSubscriptions = listHandler(service.listSubscriptions);
export const listWorkspaces = listHandler(service.listWorkspaces);

export async function getPipelineEntry(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getPipelineEntry(req.params.id as string));
  } catch (e) {
    next(e);
  }
}
export async function getSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getSubscription(req.params.id as string));
  } catch (e) {
    next(e);
  }
}
export async function getWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getWorkspace(req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function createPipelineQuote(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.createPipelineQuote(guard(req), createPipelineSchema.parse(req.body), req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function renewSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.renewSubscription(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

// ---- Pipeline stage transitions -------------------------------------------

export async function acceptPipeline(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.acceptPipelineQuote(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function declinePipeline(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.declinePipelineQuote(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function saveRegistration(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(
      res,
      await service.saveRegistration(guard(req), req.params.id as string, saveRegistrationSchema.parse(req.body), req.ip ?? null),
    );
  } catch (e) {
    next(e);
  }
}

export async function uploadPaymentProof(req: Request, res: Response, next: NextFunction) {
  try {
    const { proofUrl } = uploadProofSchema.parse(req.body ?? {});
    sendOk(res, await service.uploadPaymentProof(guard(req), req.params.id as string, proofUrl, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function verifyPayment(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.verifyPayment(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function provisionPipeline(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.provisionPipeline(guard(req), req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
