import { Op, type WhereOptions } from "sequelize";
import { KbArticle } from "../../db/models";
import type { KbStatus } from "../../db/models/kbArticle.model";
import { KB_STATUSES } from "../../db/models/kbArticle.model";
import type { AuthContext } from "../../lib/scope";
import { categoryName, isValidCategory } from "./kb.categories";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateArticleInput {
  title: string;
  category: string;
  status?: KbStatus;
  author?: string;
  summary?: string | null;
  content?: string;
  keywords?: string[];
  featured?: boolean;
}

export type UpdateArticleInput = Partial<CreateArticleInput>;

export interface ListArticleFilters {
  category?: string;
  status?: KbStatus;
  search?: string;
}

export interface ArticleView {
  id: string;
  code: string;
  title: string;
  category: string;
  categoryName: string;
  status: KbStatus;
  author: string;
  summary: string | null;
  content: string;
  keywords: string[];
  featured: boolean;
  views: number;
  uniqueViews: number;
  helpful: number;
  notHelpful: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function isServiceOwner(auth: AuthContext): boolean {
  return auth.orgType === "ServiceOwner";
}

function assertServiceOwner(auth: AuthContext): void {
  if (!isServiceOwner(auth)) throw new ForbiddenError("Only the Service Owner can manage knowledge base articles");
}

function toView(a: KbArticle): ArticleView {
  return {
    id: a.id,
    code: a.code,
    title: a.title,
    category: a.category,
    categoryName: categoryName(a.category),
    status: a.status,
    author: a.author,
    summary: a.summary,
    content: a.content,
    keywords: a.keywords,
    featured: a.featured,
    views: a.views,
    uniqueViews: a.uniqueViews,
    helpful: a.helpful,
    notHelpful: a.notHelpful,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Next article code in the KB-2026-#### sequence (starts at 0001). */
async function nextArticleCode(): Promise<string> {
  const rows = await KbArticle.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const m = /KB-2026-(\d+)/.exec(r.code || "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `KB-2026-${String(max + 1).padStart(4, "0")}`;
}

/**
 * List articles. The Service Owner sees every article (any status); every other
 * persona sees only Published articles. A category/status/search filter narrows
 * within that visibility.
 */
export async function listArticles(auth: AuthContext, filters: ListArticleFilters = {}): Promise<ArticleView[]> {
  const where: WhereOptions = {};
  if (!isServiceOwner(auth)) {
    Object.assign(where, { status: "Published" });
  } else if (filters.status) {
    Object.assign(where, { status: filters.status });
  }
  if (filters.category) Object.assign(where, { category: filters.category });
  if (filters.search) {
    const term = `%${filters.search}%`;
    Object.assign(where, { [Op.or]: [{ title: { [Op.iLike]: term } }, { summary: { [Op.iLike]: term } }] });
  }
  const rows = await KbArticle.findAll({ where, order: [["updatedAt", "DESC"]] });
  return rows.map(toView);
}

async function requireVisible(auth: AuthContext, id: string): Promise<KbArticle> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  // Non-SP personas may only see Published articles — 404 otherwise so drafts stay hidden.
  if (!isServiceOwner(auth) && a.status !== "Published") {
    throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  }
  return a;
}

export async function getArticle(auth: AuthContext, id: string): Promise<ArticleView> {
  const a = await requireVisible(auth, id);
  return toView(a);
}

/** Read + count a view (used when a reader opens the article detail). */
export async function viewArticle(auth: AuthContext, id: string): Promise<ArticleView> {
  const a = await requireVisible(auth, id);
  a.views += 1;
  a.uniqueViews += 1;
  await a.save();
  return toView(a);
}

function assertValid(category: string | undefined, status: KbStatus | undefined): void {
  if (category !== undefined && !isValidCategory(category)) throw new BadRequestError(`Invalid category: ${category}`, "INVALID_CATEGORY");
  if (status !== undefined && !KB_STATUSES.includes(status)) throw new BadRequestError(`Invalid status: ${status}`, "INVALID_STATUS");
}

export async function createArticle(auth: AuthContext, input: CreateArticleInput, ip: string | null): Promise<ArticleView> {
  assertServiceOwner(auth);
  assertValid(input.category, input.status);
  const status = input.status ?? "Draft";
  const a = await KbArticle.create({
    code: await nextArticleCode(),
    title: input.title,
    category: input.category,
    status,
    author: input.author ?? "AXIA Support",
    summary: input.summary ?? null,
    content: input.content ?? "",
    keywords: input.keywords ?? [],
    featured: input.featured ?? false,
    publishedAt: status === "Published" ? new Date() : null,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.article.created", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return toView(a);
}

export async function updateArticle(auth: AuthContext, id: string, input: UpdateArticleInput, ip: string | null): Promise<ArticleView> {
  assertServiceOwner(auth);
  assertValid(input.category, input.status);
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  if (input.title !== undefined) a.title = input.title;
  if (input.category !== undefined) a.category = input.category;
  if (input.author !== undefined) a.author = input.author;
  if (input.summary !== undefined) a.summary = input.summary ?? null;
  if (input.content !== undefined) a.content = input.content;
  if (input.keywords !== undefined) a.keywords = input.keywords;
  if (input.featured !== undefined) a.featured = input.featured;
  if (input.status !== undefined) {
    a.status = input.status;
    if (input.status === "Published" && !a.publishedAt) a.publishedAt = new Date();
  }
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.article.updated", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return toView(a);
}

export async function publishArticle(auth: AuthContext, id: string, ip: string | null): Promise<ArticleView> {
  assertServiceOwner(auth);
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  a.status = "Published";
  if (!a.publishedAt) a.publishedAt = new Date();
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.article.published", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return toView(a);
}

export async function archiveArticle(auth: AuthContext, id: string, ip: string | null): Promise<ArticleView> {
  assertServiceOwner(auth);
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  a.status = "Archived";
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.article.archived", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return toView(a);
}

/** Record a helpful / not-helpful vote. Any authenticated persona may vote on a Published article. */
export async function voteArticle(auth: AuthContext, id: string, helpful: boolean): Promise<ArticleView> {
  const a = await requireVisible(auth, id);
  if (helpful) a.helpful += 1;
  else a.notHelpful += 1;
  await a.save();
  return toView(a);
}
