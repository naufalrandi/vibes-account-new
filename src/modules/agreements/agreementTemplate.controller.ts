import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./agreementTemplate.service";
import type { AgreementTemplateStatus } from "../../db/models/agreementTemplate.model";
import { AGREEMENT_VARIABLES } from "./variables.catalog";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

/** The agreement variable catalog for the document editor's variable panel. */
export async function variables(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, AGREEMENT_VARIABLES, 200, { page: 1, limit: AGREEMENT_VARIABLES.length, total: AGREEMENT_VARIABLES.length });
  } catch (e) {
    next(e);
  }
}

const statusSchema = z.enum(["Draft", "Active", "Archived"]);
const blockSchema = z.object({
  id: z.string(),
  type: z.enum(["heading", "paragraph", "clause", "bullet", "divider", "signature"]),
  text: z.string(),
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  version: z.string().min(1).optional(),
  status: statusSchema.optional(),
  blocks: z.array(blockSchema).optional(),
});

const updateSchema = createSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status = typeof req.query.status === "string" ? (req.query.status as AgreementTemplateStatus) : undefined;
    const rows = await service.listAgreements(req.auth, { status });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getAgreement(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createAgreement(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateAgreement(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.duplicateAgreement(req.auth, req.params.id as string, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteAgreement(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
