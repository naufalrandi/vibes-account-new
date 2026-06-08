import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./ticket.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const categorySchema = z.enum(["Technical Support", "Billing", "Commercial", "Feature Request", "Bug Report", "General Inquiry"]);
const prioritySchema = z.enum(["Low", "Medium", "High", "Critical"]);
const statusSchema = z.enum(["Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"]);

const createSchema = z.object({
  subject: z.string().min(1),
  description: z.string().min(1),
  category: categorySchema,
  priority: prioritySchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const str = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
    const rows = await service.listTickets(req.auth, {
      status: str("status") as never,
      priority: str("priority") as never,
      category: str("category") as never,
      search: str("search"),
    });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getTicket(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createTicket(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function reply(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const text = z.object({ text: z.string().min(1) }).parse(req.body).text;
    sendOk(res, await service.replyTicket(req.auth, req.params.id as string, text, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function setStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status = z.object({ status: statusSchema }).parse(req.body).status;
    sendOk(res, await service.setTicketStatus(req.auth, req.params.id as string, status, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const assignee = z.object({ assignee: z.string().nullable() }).parse(req.body).assignee;
    sendOk(res, await service.assignTicket(req.auth, req.params.id as string, assignee, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
