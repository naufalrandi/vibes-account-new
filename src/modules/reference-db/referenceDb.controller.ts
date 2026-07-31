import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./referenceDb.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());

function guard(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
const ip = (req: Request) => req.ip ?? null;
const ok = (res: Response, data: unknown, code = 200) =>
  sendOk(res, data, code, Array.isArray(data) ? { page: 1, limit: data.length, total: data.length } : undefined);

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Education Levels
export const listEducationLevels = wrap(async (req, res) => ok(res, await service.listEducationLevels(guard(req))));
export const createEducationLevel = wrap(async (req, res) => ok(res, await service.createEducationLevel(guard(req), body.parse(req.body), ip(req)), 201));
export const updateEducationLevel = wrap(async (req, res) => ok(res, await service.updateEducationLevel(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteEducationLevel = wrap(async (req, res) => { await service.deleteEducationLevel(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Industry Sectors
export const listIndustrySectors = wrap(async (req, res) => ok(res, await service.listIndustrySectors(guard(req))));
export const createIndustrySector = wrap(async (req, res) => ok(res, await service.createIndustrySector(guard(req), body.parse(req.body), ip(req)), 201));
export const updateIndustrySector = wrap(async (req, res) => ok(res, await service.updateIndustrySector(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteIndustrySector = wrap(async (req, res) => { await service.deleteIndustrySector(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Fields of Education
export const listEducationFields = wrap(async (req, res) => ok(res, await service.listEducationFields(guard(req))));
export const createEducationField = wrap(async (req, res) => ok(res, await service.createEducationField(guard(req), body.parse(req.body), ip(req)), 201));
export const updateEducationField = wrap(async (req, res) => ok(res, await service.updateEducationField(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteEducationField = wrap(async (req, res) => { await service.deleteEducationField(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Sector Frameworks
export const listSectorFrameworks = wrap(async (req, res) => ok(res, await service.listSectorFrameworks(guard(req))));
export const createSectorFramework = wrap(async (req, res) => ok(res, await service.createSectorFramework(guard(req), body.parse(req.body), ip(req)), 201));
export const updateSectorFramework = wrap(async (req, res) => ok(res, await service.updateSectorFramework(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteSectorFramework = wrap(async (req, res) => { await service.deleteSectorFramework(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Countries
export const listCountries = wrap(async (req, res) => ok(res, await service.listCountries(guard(req))));
export const createCountry = wrap(async (req, res) => ok(res, await service.createCountry(guard(req), body.parse(req.body), ip(req)), 201));
export const updateCountry = wrap(async (req, res) => ok(res, await service.updateCountry(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteCountry = wrap(async (req, res) => { await service.deleteCountry(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });
