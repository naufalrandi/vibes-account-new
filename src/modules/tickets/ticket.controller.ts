import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./ticket.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";
import type { TicketCategory, TicketPriority, TicketStatus } from "../../db/models/ticket.model";

const categorySchema = z.enum(["Technical Support", "Billing", "Commercial", "Feature Request", "Bug Report", "General Inquiry"]);
const prioritySchema = z.enum(["Low", "Medium", "High", "Critical"]);
const statusSchema = z.enum(["Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"]);

const createSchema = z.object({
  subject: z.string().min(1).max(255),
  description: z.string().min(1),
  category: categorySchema,
  priority: prioritySchema.optional(),
});
const replySchema = z.object({ text: z.string().min(1) });
const assignSchema = z.object({ assignee: z.string().nullable() });

const guard = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listTickets(guard(req), {
      status: req.query.status as TicketStatus | undefined,
      priority: req.query.priority as TicketPriority | undefined,
      category: req.query.category as TicketCategory | undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
    });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.getTicket(guard(req), req.params.id as string)); }
  catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try { sendOk(res, await service.createTicket(guard(req), createSchema.parse(req.body), req.ip ?? null), 201); }
  catch (e) { next(e); }
}

export async function reply(req: Request, res: Response, next: NextFunction) {
  try { const { text } = replySchema.parse(req.body); sendOk(res, await service.replyTicket(guard(req), req.params.id as string, text, req.ip ?? null)); }
  catch (e) { next(e); }
}

export async function status(req: Request, res: Response, next: NextFunction) {
  try { const { status: s } = z.object({ status: statusSchema }).parse(req.body); sendOk(res, await service.setStatus(guard(req), req.params.id as string, s, req.ip ?? null)); }
  catch (e) { next(e); }
}

export async function assign(req: Request, res: Response, next: NextFunction) {
  try { const { assignee } = assignSchema.parse(req.body); sendOk(res, await service.assignTicket(guard(req), req.params.id as string, assignee, req.ip ?? null)); }
  catch (e) { next(e); }
}
