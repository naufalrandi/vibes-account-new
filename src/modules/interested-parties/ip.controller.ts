import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./ip.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const body = z.record(z.string(), z.unknown());
function guard(req: Request): AuthContext { if (!req.auth) throw new UnauthorizedError(); return req.auth; }
const ip = (req: Request) => req.ip ?? null;
const listMeta = (d: unknown[]) => ({ page: 1, limit: d.length, total: d.length });
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };

// Parties
export const listParties = wrap(async (req, res) => { const d = await service.listParties(guard(req)); sendOk(res, d, 200, listMeta(d)); });
export const getParty = wrap(async (req, res) => sendOk(res, await service.getParty(guard(req), req.params.id as string)));
export const createParty = wrap(async (req, res) => sendOk(res, await service.createParty(guard(req), body.parse(req.body), typeof req.query.orgId === "string" ? req.query.orgId : undefined, ip(req)), 201));
export const updateParty = wrap(async (req, res) => sendOk(res, await service.updateParty(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const archiveParty = wrap(async (req, res) => sendOk(res, await service.archiveParty(guard(req), req.params.id as string, ip(req))));

// Requirements
export const listRequirements = wrap(async (req, res) => { const d = await service.listRequirements(guard(req), typeof req.query.partyId === "string" ? req.query.partyId : undefined); sendOk(res, d, 200, listMeta(d)); });
export const createRequirement = wrap(async (req, res) => sendOk(res, await service.createRequirement(guard(req), body.parse(req.body), ip(req)), 201));
export const updateRequirement = wrap(async (req, res) => sendOk(res, await service.updateRequirement(guard(req), req.params.id as string, body.parse(req.body), ip(req))));
export const setRequirementStatus = wrap(async (req, res) => { const b = z.object({ status: z.string().min(1), justification: z.string().nullish() }).parse(req.body); sendOk(res, await service.setRequirementStatus(guard(req), req.params.id as string, b.status, b.justification ?? null, ip(req))); });
export const raiseRisk = wrap(async (req, res) => { const b = z.object({ description: z.string().nullish() }).parse(req.body); sendOk(res, await service.raiseRisk(guard(req), req.params.id as string, b.description ?? null, ip(req)), 201); });
export const linkObligations = wrap(async (req, res) => { const b = z.object({ obligations: z.array(z.string()) }).parse(req.body); sendOk(res, await service.linkObligations(guard(req), req.params.id as string, b.obligations, ip(req))); });
export const archiveRequirement = wrap(async (req, res) => { const b = z.object({ justification: z.string().nullish() }).parse(req.body); sendOk(res, await service.archiveRequirement(guard(req), req.params.id as string, b.justification ?? null, ip(req))); });
