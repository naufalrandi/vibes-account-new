import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./business.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import { getBusinessDataSchema } from "./dataSchemas";

const inputSchema = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  owner: z.string().nullish(),
  company: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Parses the generic envelope, then — if the module has a registered
 * payload schema (SOF-23, `dataSchemas.ts`) — re-validates `data` against
 * it. Since SOF-38 every registered key has one; what still bypasses
 * validation is only a route with no `:module` param (e.g.
 * `createFromProposal`), which has nothing to dispatch on.
 */
function parseInput(module: string | undefined, body: unknown) {
  const input = inputSchema.parse(body);
  if (input.data !== undefined && module !== undefined) {
    const dataSchema = getBusinessDataSchema(module);
    if (dataSchema) input.data = dataSchema.parse(input.data) as Record<string, unknown>;
  }
  return input;
}

const guard = (req: Request): AuthContext => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

/**
 * Resolves the operating company the caller is acting as, from the same
 * places `list` already read it from (query param, then header). Applied
 * consistently to `update`/`remove` too (C-3) so a cross-company id lookup
 * on those paths is scoped exactly like `list` and `create` already are.
 */
const resolveCompanyParam = (req: Request): string | undefined =>
  (req.query.company as string) || (req.headers["x-company"] as string) || undefined;

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const company = resolveCompanyParam(req);
    const filters = {
      q: req.query.q as string | undefined,
      status: req.query.status as string | undefined,
      owner: req.query.owner as string | undefined,
      sort: req.query.sort as string | undefined,
    };
    const rows = await service.listBusiness(guard(req), req.params.area as string, req.params.module as string, company, filters);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const input = parseInput(req.params.module as string, req.body);
    sendOk(res, await service.createBusiness(guard(req), req.params.area as string, req.params.module as string, input, req.ip ?? null), 201);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const input = parseInput(req.params.module as string, req.body);
    const company = resolveCompanyParam(req);
    sendOk(res, await service.updateBusiness(guard(req), req.params.area as string, req.params.module as string, req.params.id as string, input, req.ip ?? null, company));
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const company = resolveCompanyParam(req);
    await service.deleteBusiness(guard(req), req.params.area as string, req.params.module as string, req.params.id as string, req.ip ?? null, company);
    sendOk(res, { id: req.params.id });
  } catch (e) { next(e); }
}

export async function createFromProposal(req: Request, res: Response, next: NextFunction) {
  try {
    const input = inputSchema.parse(req.body);
    const company = resolveCompanyParam(req);
    sendOk(res, await service.createProjectFromProposal(guard(req), req.params.proposalId as string, input, req.ip ?? null, company), 201);
  } catch (e) { next(e); }
}

const priceSchema = z.object({
  auditType: z.enum(["Stage 1", "Stage 2", "Surveillance 1", "Surveillance 2", "Recertification"]).optional(),
});

export async function priceCabClient(req: Request, res: Response, next: NextFunction) {
  try {
    const input = priceSchema.parse(req.body ?? {});
    const company = resolveCompanyParam(req);
    sendOk(res, await service.priceCabClient(guard(req), req.params.id as string, input.auditType, req.ip ?? null, company));
  } catch (e) { next(e); }
}

export async function getCabRate(req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await service.getCabRate(guard(req)));
  } catch (e) { next(e); }
}

/** OD `cabSetRate` — the "Rate per man-day" modal's only write path. */
export async function setCabRate(req: Request, res: Response, next: NextFunction) {
  try {
    const input = z.object({ ratePerMd: z.number().int().positive().max(1_000_000_000) }).parse(req.body ?? {});
    sendOk(res, await service.setCabRate(guard(req), input.ratePerMd, req.ip ?? null));
  } catch (e) { next(e); }
}

export async function issueCabCertificate(req: Request, res: Response, next: NextFunction) {
  try {
    const company = resolveCompanyParam(req);
    sendOk(res, await service.issueCabCertificate(guard(req), req.params.id as string, req.ip ?? null, company));
  } catch (e) { next(e); }
}
