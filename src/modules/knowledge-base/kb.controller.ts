import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./kb.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Published", "Archived"]);
const inputSchema = z.object({
  title: z.string().max(300).optional(),
  category: z.string().max(80).optional(),
  status: statusSchema.optional(),
  author: z.string().max(200).optional(),
  summary: z.string().nullish(),
  content: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
});

export function categories(_req: Request, res: Response) {
  sendOk(res, service.listCategories());
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as "Draft" | "Published" | "Archived") : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const rows = await service.listArticles(req.auth, { category, status, search });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const track = req.query.track === "1" || req.query.track === "true";
    sendOk(res, await service.getArticle(req.auth, req.params.id as string, track));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = inputSchema.parse(req.body);
    // The service enforces title/category presence (throws BadRequest if missing).
    sendOk(res, await service.createArticle(req.auth, { ...input, title: input.title ?? "", category: input.category ?? "" }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = inputSchema.parse(req.body);
    sendOk(res, await service.updateArticle(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function publish(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.setStatus(req.auth, req.params.id as string, "Published", req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.setStatus(req.auth, req.params.id as string, "Archived", req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function vote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const helpful = Boolean(req.body?.helpful);
    sendOk(res, await service.vote(req.auth, req.params.id as string, helpful));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteArticle(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
