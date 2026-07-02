import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./recordEvent.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";

const commentSchema = z.object({ text: z.string() });
const guard = (req: Request): AuthContext => { if (!req.auth) throw new UnauthorizedError(); return req.auth; };

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listEvents(guard(req), req.params.module as string, req.params.recordId as string);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function comment(req: Request, res: Response, next: NextFunction) {
  try {
    const { text } = commentSchema.parse(req.body);
    sendOk(res, await service.addComment(guard(req), req.params.module as string, req.params.recordId as string, text), 201);
  } catch (e) { next(e); }
}
