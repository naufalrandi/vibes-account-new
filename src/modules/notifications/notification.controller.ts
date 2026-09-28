import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./notification.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await service.listForActor(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

/** No body (or no `ids`) marks everything read; `{ ids }` marks just those. */
const markReadSchema = z.object({ ids: z.array(z.string().uuid()).max(500).optional() });

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { ids } = markReadSchema.parse(req.body ?? {});
    const updated = await service.markRead(req.auth, ids);
    sendOk(res, { updated });
  } catch (e) {
    next(e);
  }
}
