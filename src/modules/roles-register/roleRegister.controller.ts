import type { Request, Response, NextFunction } from "express";
import * as service from "./roleRegister.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const guard = (req: Request): AuthContext => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };
const listMeta = (n: number) => ({ page: 1, limit: n, total: n });

export async function listTemplates(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listTemplates(guard(req)); sendOk(res, rows, 200, listMeta(rows.length)); } catch (e) { next(e); }
}

export async function listAssignments(req: Request, res: Response, next: NextFunction) {
  try { const rows = await service.listAssignments(guard(req)); sendOk(res, rows, 200, listMeta(rows.length)); } catch (e) { next(e); }
}
