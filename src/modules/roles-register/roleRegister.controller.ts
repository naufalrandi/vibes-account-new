import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./roleRegister.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const strArr = z.array(z.string()).optional();
const templateSchema = z.object({
  name: z.string().optional(), category: z.string().optional(), purpose: z.string().nullish(),
  workUnits: strArr, processes: strArr, frameworks: strArr, responsibilities: strArr, authorities: strArr,
  status: z.string().optional(), notes: z.string().nullish(),
});
const assignSchema = z.object({
  memberId: z.string().optional(), memberName: z.string().optional(), roleId: z.string().uuid().optional(),
  workUnit: z.string().nullish(), effectiveDate: z.string().nullish(),
  responsibilities: strArr, authorities: strArr, status: z.string().optional(), notes: z.string().nullish(), modReason: z.string().nullish(),
});

const guard = (req: Request): AuthContext => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };
const listMeta = (n: number) => ({ page: 1, limit: n, total: n });

export async function listTemplates(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listTemplates(guard(req)); sendOk(res, rows, 200, listMeta(rows.length)); } catch (e) { next(e); }
}
export async function createTemplate(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createTemplate(guard(req), templateSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function updateTemplate(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateTemplate(guard(req), req.params.id as string, templateSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function archiveTemplate(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.archiveTemplate(guard(req), req.params.id as string, req.ip ?? null)); } catch (e) { next(e); }
}

export async function listAssignments(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listAssignments(guard(req)); sendOk(res, rows, 200, listMeta(rows.length)); } catch (e) { next(e); }
}
export async function assign(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.assignRole(guard(req), assignSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function updateAssignment(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateAssignment(guard(req), req.params.id as string, assignSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function archiveAssignment(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.archiveAssignment(guard(req), req.params.id as string, req.ip ?? null)); } catch (e) { next(e); }
}
