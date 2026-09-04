import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sendOk } from "../../lib/apiResponse";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import * as svc from "./poConfirmation";

/**
 * Public (unauthenticated) supplier PO confirmation. Mounted before the blanket
 * `/v1` authenticate, like `/v1/public/cms`.
 *
 * Every rejection returns the same INVALID_LINK error regardless of cause. A
 * public endpoint that distinguished "no such PO" from "wrong token" would be
 * an oracle for which PO codes exist.
 */
const INVALID = "This confirmation link is invalid or expired.";

const tokenSchema = z.object({ t: z.string().min(1).max(512) });
const bodySchema = z.object({
  state: z.enum(["Acknowledged", "Declined"]),
  note: z.string().max(2000).optional().default(""),
});

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = tokenSchema.safeParse(req.query);
    if (!parsed.success) throw new NotFoundError(INVALID, "INVALID_LINK");
    const view = await svc.getPoConfirmation(String(req.params.id ?? ""), parsed.data.t);
    if (!view) throw new NotFoundError(INVALID, "INVALID_LINK");
    sendOk(res, view);
  } catch (err) {
    next(err);
  }
}

export async function respond(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = tokenSchema.safeParse(req.query);
    const body = bodySchema.safeParse(req.body);
    if (!q.success || !body.success) throw new NotFoundError(INVALID, "INVALID_LINK");
    const result = await svc.respondPoConfirmation(
      String(req.params.id ?? ""), q.data.t, body.data.state, body.data.note,
    );
    if (result.ok) {
      sendOk(res, result.view);
      return;
    }
    if (result.reason === "already") {
      throw new BadRequestError("A response has already been recorded.", "ALREADY_RESPONDED");
    }
    throw new NotFoundError(INVALID, "INVALID_LINK");
  } catch (err) {
    next(err);
  }
}
