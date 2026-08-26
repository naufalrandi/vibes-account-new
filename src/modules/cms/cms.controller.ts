import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as pageService from "./cmsPage.service";
import * as postService from "./cmsPost.service";
import * as mediaService from "./cmsMedia.service";
import * as menuService from "./cmsMenu.service";
import * as settingsService from "./cmsSettings.service";
import { sendOk } from "../../lib/apiResponse";
import { BadRequestError, UnauthorizedError } from "../../lib/errors";

const pageTemplateSchema = z.enum(["Home", "Pricing", "Contact", "Landing"]);
const pageStatusSchema = z.enum(["Draft", "InReview", "Published", "Archived"]);
const postStatusSchema = z.enum(["Draft", "InReview", "Published", "Archived", "Scheduled"]);

const pageInputSchema = z.object({
  title: z.string().max(300).optional(),
  slug: z.string().max(200).optional(),
  path: z.string().max(500).nullish(),
  template: pageTemplateSchema.optional(),
  status: pageStatusSchema.optional(),
  author: z.string().max(200).nullish(),
  seoTitle: z.string().max(200).nullish(),
  seoDesc: z.string().max(500).nullish(),
  body: z.string().max(200_000).optional(),
});

const postInputSchema = z.object({
  title: z.string().max(300).optional(),
  slug: z.string().max(200).optional(),
  author: z.string().max(200).nullish(),
  category: z.string().max(200).nullish(),
  tags: z.array(z.string().max(50)).max(50).optional(),
  status: postStatusSchema.optional(),
  excerpt: z.string().max(1_000).nullish(),
  body: z.string().max(200_000).optional(),
  publishDate: z.string().max(40).nullish(),
});

const menuItemInputSchema = z.object({
  label: z.string().max(200).optional(),
  pageId: z.string().uuid().nullish(),
  url: z.string().max(2_000).nullish(),
  order: z.number().int().optional(),
});

const reorderInputSchema = z.array(z.object({ id: z.string().uuid(), order: z.number().int() })).max(500);

const settingsInputSchema = z.object({
  siteName: z.string().max(200).nullish(),
  domain: z.string().max(200).nullish(),
  tagline: z.string().max(300).nullish(),
  primaryColor: z.string().max(20).nullish(),
  seoTitle: z.string().max(200).nullish(),
  seoDesc: z.string().max(500).nullish(),
  analytics: z.string().max(100).nullish(),
  live: z.boolean().optional(),
});

// --- Pages ------------------------------------------------------------------

export async function listPages(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status = typeof req.query.status === "string" ? (req.query.status as never) : undefined;
    const rows = await pageService.listPages(req.auth, { status });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function getPage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await pageService.getPage(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function createPage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = pageInputSchema.parse(req.body);
    sendOk(res, await pageService.createPage(req.auth, { ...input, title: input.title ?? "" }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updatePage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = pageInputSchema.parse(req.body);
    sendOk(res, await pageService.updatePage(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function publishPage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await pageService.publishPage(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function archivePage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await pageService.archivePage(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

// --- Posts ------------------------------------------------------------------

export async function listPosts(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const status = typeof req.query.status === "string" ? (req.query.status as never) : undefined;
    const rows = await postService.listPosts(req.auth, { status });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function getPost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await postService.getPost(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function createPost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = postInputSchema.parse(req.body);
    sendOk(res, await postService.createPost(req.auth, { ...input, title: input.title ?? "" }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updatePost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = postInputSchema.parse(req.body);
    sendOk(res, await postService.updatePost(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function publishPost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await postService.publishPost(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function archivePost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await postService.archivePost(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

// --- Media -------------------------------------------------------------------

export async function listMedia(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await mediaService.listMedia(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function uploadMedia(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    if (!req.file) throw new BadRequestError("A file is required", "FILE_REQUIRED");
    const alt = typeof req.body?.alt === "string" ? req.body.alt : null;
    sendOk(res, await mediaService.recordUpload(req.auth, req.file, alt, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function removeMedia(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await mediaService.deleteMedia(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

// --- Menu --------------------------------------------------------------------

export async function listMenu(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const rows = await menuService.listMenuItems(req.auth);
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function createMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = menuItemInputSchema.parse(req.body);
    sendOk(res, await menuService.createMenuItem(req.auth, { ...input, label: input.label ?? "" }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = menuItemInputSchema.parse(req.body);
    sendOk(res, await menuService.updateMenuItem(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function removeMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await menuService.deleteMenuItem(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

export async function reorderMenu(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = reorderInputSchema.parse(req.body);
    sendOk(res, await menuService.reorderMenuItems(req.auth, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

// --- Settings ------------------------------------------------------------------

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await settingsService.getSettings(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function putSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = settingsInputSchema.parse(req.body);
    sendOk(res, await settingsService.putSettings(req.auth, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
