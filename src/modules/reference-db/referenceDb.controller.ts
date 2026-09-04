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

// Education Levels [DEPRECATED / ORPHANED — see referenceDb.service.ts]
export const listEducationLevels = wrap(async (req, res) => ok(res, await service.listEducationLevels(guard(req))));
export const createEducationLevel = wrap(async (req, res) => ok(res, await service.createEducationLevel(guard(req), body.parse(req.body), ip(req)), 201));
export const updateEducationLevel = wrap(async (req, res) => ok(res, await service.updateEducationLevel(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteEducationLevel = wrap(async (req, res) => { const r = await service.deleteEducationLevel(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id, ...r }); });

// Industry Sectors
export const listIndustrySectors = wrap(async (req, res) => ok(res, await service.listIndustrySectors(guard(req))));
export const createIndustrySector = wrap(async (req, res) => ok(res, await service.createIndustrySector(guard(req), body.parse(req.body), ip(req)), 201));
export const updateIndustrySector = wrap(async (req, res) => ok(res, await service.updateIndustrySector(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteIndustrySector = wrap(async (req, res) => { const r = await service.deleteIndustrySector(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id, ...r }); });

// Fields of Education
export const listEducationFields = wrap(async (req, res) => ok(res, await service.listEducationFields(guard(req))));
export const createEducationField = wrap(async (req, res) => ok(res, await service.createEducationField(guard(req), body.parse(req.body), ip(req)), 201));
export const updateEducationField = wrap(async (req, res) => ok(res, await service.updateEducationField(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteEducationField = wrap(async (req, res) => { const r = await service.deleteEducationField(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id, ...r }); });

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

// Banks
export const listBanks = wrap(async (req, res) => ok(res, await service.listBanks(guard(req))));
export const createBank = wrap(async (req, res) => ok(res, await service.createBank(guard(req), body.parse(req.body), ip(req)), 201));
export const updateBank = wrap(async (req, res) => ok(res, await service.updateBank(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteBank = wrap(async (req, res) => { await service.deleteBank(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Holidays
export const listHolidays = wrap(async (req, res) => ok(res, await service.listHolidays(guard(req))));
export const createHoliday = wrap(async (req, res) => ok(res, await service.createHoliday(guard(req), body.parse(req.body), ip(req)), 201));
export const updateHoliday = wrap(async (req, res) => ok(res, await service.updateHoliday(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteHoliday = wrap(async (req, res) => { await service.deleteHoliday(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Business process catalog
export const listBpProcesses = wrap(async (req, res) => ok(res, await service.listBpProcesses(guard(req))));
export const createBpProcess = wrap(async (req, res) => ok(res, await service.createBpProcess(guard(req), body.parse(req.body), ip(req)), 201));
export const updateBpProcess = wrap(async (req, res) => ok(res, await service.updateBpProcess(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const deleteBpProcess = wrap(async (req, res) => { await service.deleteBpProcess(guard(req), req.params.id as string, ip(req)); ok(res, { id: req.params.id }); });

// Fiscal periods — one config row per org, plus the per-period Open/Closed toggle.
export const getFiscalConfig = wrap(async (req, res) => ok(res, await service.getFiscalConfig(guard(req))));
export const updateFiscalConfig = wrap(async (req, res) => ok(res, await service.updateFiscalConfig(guard(req), body.parse(req.body), ip(req))));
export const setFiscalPeriodStatus = wrap(async (req, res) => {
  const b = z.object({ status: z.enum(["Open", "Closed"]) }).parse(req.body ?? {});
  ok(res, await service.setFiscalPeriodStatus(guard(req), req.params.id as string, b.status, ip(req)));
});
