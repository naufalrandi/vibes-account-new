import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./kb.service";
import { KB_CATEGORIES } from "./kb.categories";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const statusSchema = z.enum(["Draft", "Published", "Archived"]);

const createSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  status: statusSchema.optional(),
  author: z.string().optional(),
  summary: z.string().nullish(),
  content: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export function categories(_req: Request, res: Response) {
  sendOk(res, KB_CATEGORIES);
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
    // ?track=1 increments the view counter (reader opened the article).
    const track = req.query.track === "1" || req.query.track === "true";
    const article = track
      ? await service.viewArticle(req.auth, req.params.id as string)
      : await service.getArticle(req.auth, req.params.id as string);
    sendOk(res, article);
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = createSchema.parse(req.body);
    sendOk(res, await service.createArticle(req.auth, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = updateSchema.parse(req.body);
    sendOk(res, await service.updateArticle(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function publish(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.publishArticle(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.archiveArticle(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function vote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const helpful = req.body?.helpful === true;
    sendOk(res, await service.voteArticle(req.auth, req.params.id as string, helpful));
  } catch (e) {
    next(e);
  }
}
