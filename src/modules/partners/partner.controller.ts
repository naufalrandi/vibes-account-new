import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./partner.service";
import * as agreement from "./partnerAgreement.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const generateSchema = z.object({
  templateId: z.string().uuid(),
  vars: z.record(z.string(), z.string()).optional(),
});

const tierSchema = z.enum(["Bronze", "Silver", "Gold"]);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  tier: tierSchema.optional(),
  admin: z.object({ fullName: z.string().min(1), username: z.string().min(1), email: z.string().email() }),
  // "send" generates & sends the agreement immediately; "draft" leaves it Draft.
  mode: z.enum(["draft", "send"]).optional(),
  agreement: generateSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  country: z.string().nullish(),
  address: z.string().nullish(),
  tier: tierSchema.optional(),
});

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { mode, agreement: agr, ...rest } = createSchema.parse(req.body);
    const partner = await service.createPartner(req.auth, rest, req.ip ?? null);
    if (mode === "send" && agr) {
      await agreement.generate(req.auth, partner.id, agr, req.ip ?? null);
    }
    sendOk(res, await service.getPartner(req.auth, partner.id), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updatePartner(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

function lifecycle(fn: (auth: NonNullable<Request["auth"]>, id: string, ip: string | null) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      sendOk(res, await fn(req.auth, req.params.id as string, req.ip ?? null));
    } catch (e) {
      next(e);
    }
  };
}

export const activate = lifecycle(service.activatePartner);
export const suspend = lifecycle(service.suspendPartner);
export const resume = lifecycle(service.resumePartner);
export const terminate = lifecycle(service.terminatePartner);

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const filters = {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      country: typeof req.query.country === "string" ? req.query.country : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
    };
    const rows = await service.listPartners(req.auth, filters);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getPartner(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function getAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await agreement.getForPartner(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function generateAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = generateSchema.parse(req.body);
    sendOk(res, await agreement.generate(req.auth, req.params.id as string, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function regenerateAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await agreement.regenerate(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function resendAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await agreement.resend(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function approveAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await agreement.approve(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
