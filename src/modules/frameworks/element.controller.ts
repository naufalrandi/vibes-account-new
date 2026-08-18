import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./element.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

// OD vocabulary is Active/Inactive; Draft/Archived stay accepted as legacy values.
const statusSchema = z.enum(["Draft", "Active", "Inactive", "Archived"]);
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  status: statusSchema.optional(),
  category: z.enum(["Core", "Framework Extension"]).optional(),
});
const updateSchema = createSchema.partial();
const mappingsSchema = z.object({ requirementIds: z.array(z.string().uuid()) });

const guard = (req: Request) => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };

export async function list(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listElements(guard(req)); sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length }); } catch (e) { next(e); }
}
export async function get(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getElement(guard(req), req.params.id as string)); } catch (e) { next(e); }
}
export async function create(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createElement(guard(req), createSchema.parse(req.body), req.ip ?? null), 201); } catch (e) { next(e); }
}
export async function update(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.updateElement(guard(req), req.params.id as string, updateSchema.parse(req.body), req.ip ?? null)); } catch (e) { next(e); }
}
export async function remove(req: Request, res: Response, next: NextFunction) {
  try { await service.deleteElement(guard(req), req.params.id as string, req.ip ?? null); sendOk(res, { id: req.params.id }); } catch (e) { next(e); }
}
export async function setMappings(req: Request, res: Response, next: NextFunction) {
  try { const { requirementIds } = mappingsSchema.parse(req.body); sendOk(res, await service.setMappings(guard(req), req.params.id as string, requirementIds, req.ip ?? null)); } catch (e) { next(e); }
}
export async function crossReference(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getCrossReference(guard(req))); } catch (e) { next(e); }
}
