import { Op, type WhereOptions } from "sequelize";
import { KbArticle } from "../../db/models";
import type { KbStatus } from "../../db/models/kbArticle.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/** The fixed KB category catalog (KB_CATEGORIES). */
export const KB_CATEGORIES: { id: string; name: string; desc: string }[] = [
  { id: "platform", name: "Platform Guides", desc: "Using the platform" },
  { id: "framework", name: "Framework Guides", desc: "Frameworks & assessments" },
  { id: "billing", name: "Billing", desc: "Invoices & subscriptions" },
  { id: "partner", name: "Partner Program", desc: "Partner onboarding & revenue" },
  { id: "troubleshooting", name: "Troubleshooting", desc: "Fixing common issues" },
  { id: "faq", name: "FAQs", desc: "Frequently asked questions" },
  { id: "release", name: "Release Notes", desc: "Product changes" },
];
const CAT_NAME: Record<string, string> = Object.fromEntries(KB_CATEGORIES.map((c) => [c.id, c.name]));

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
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleInput {
  title: string;
  category: string;
  status?: KbStatus;
  author?: string;
  summary?: string | null;
  content?: string;
  keywords?: string[];
  featured?: boolean;
}

function view(a: KbArticle): ArticleView {
  return {
    id: a.id, code: a.code, title: a.title, category: a.category, categoryName: CAT_NAME[a.category] ?? a.category,
    status: a.status, author: a.author, summary: a.summary, content: a.content, keywords: a.keywords ?? [],
    featured: a.featured, views: a.views, uniqueViews: a.uniqueViews, helpful: a.helpful, notHelpful: a.notHelpful,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

/** Articles the actor may see: global (org_id NULL) + own-org; non-SO sees only Published globals. */
async function scopeWhere(auth: AuthContext): Promise<WhereOptions> {
  const ids = await visibleTenantOrgIds(auth); // null = ServiceOwner (unrestricted)
  if (ids === null) return {};
  return { [Op.or]: [{ orgId: null, status: "Published" }, { orgId: { [Op.in]: ids } }] };
}

async function nextCode(): Promise<string> {
  const rows = await KbArticle.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const m = /^KB-2026-(\d+)$/.exec(r.code);
    if (m) { const n = Number.parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `KB-2026-${String(max + 1).padStart(4, "0")}`;
}

export function listCategories(): { id: string; name: string; desc: string }[] {
  return KB_CATEGORIES;
}

export async function listArticles(auth: AuthContext, filters: { category?: string; status?: KbStatus; search?: string } = {}): Promise<ArticleView[]> {
  const where: WhereOptions = { ...(await scopeWhere(auth)) };
  if (filters.category) Object.assign(where, { category: filters.category });
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.search) {
    Object.assign(where, { [Op.and]: [{ [Op.or]: [{ title: { [Op.iLike]: `%${filters.search}%` } }, { summary: { [Op.iLike]: `%${filters.search}%` } }] }] });
  }
  const rows = await KbArticle.findAll({ where, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

/** Read scope: SO → any; others → own-org articles or published globals. */
async function assertCanReadArticle(auth: AuthContext, a: KbArticle): Promise<void> {
  const ids = await visibleTenantOrgIds(auth); // null = ServiceOwner (unrestricted)
  if (ids === null) return;
  const ownedByVisible = a.orgId !== null && ids.includes(a.orgId);
  const globalPublished = a.orgId === null && a.status === "Published";
  if (!ownedByVisible && !globalPublished) throw new ForbiddenError();
}

/** Write scope: SO → any; others → own-org only (never global SO-authored articles). */
async function requireWritableArticle(auth: AuthContext, id: string): Promise<KbArticle> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && (a.orgId === null || !ids.includes(a.orgId))) throw new ForbiddenError();
  return a;
}

export async function getArticle(auth: AuthContext, id: string, track: boolean): Promise<ArticleView> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  await assertCanReadArticle(auth, a);
  if (track) {
    a.views += 1;
    a.uniqueViews += 1;
    await a.save();
  }
  return view(a);
}

function targetOrg(auth: AuthContext): string | null {
  // Service-Owner authors global articles; other orgs author for themselves.
  return auth.orgType === "ServiceOwner" ? null : auth.orgId;
}

export async function createArticle(auth: AuthContext, input: ArticleInput, ip: string | null): Promise<ArticleView> {
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  if (!input.category) throw new BadRequestError("Category is required", "CATEGORY_REQUIRED");
  const status = input.status ?? "Draft";
  const a = await KbArticle.create({
    orgId: targetOrg(auth),
    code: await nextCode(),
    title: input.title.trim(),
    category: input.category,
    status,
    author: input.author ?? "AXIA Support",
    summary: input.summary ?? null,
    content: input.content ?? "",
    keywords: input.keywords ?? [],
    featured: input.featured ?? false,
    publishedAt: status === "Published" ? new Date() : null,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.created", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return view(a);
}

export async function updateArticle(auth: AuthContext, id: string, input: Partial<ArticleInput>, ip: string | null): Promise<ArticleView> {
  const a = await requireWritableArticle(auth, id);
  if (input.title !== undefined) a.title = input.title.trim();
  if (input.category !== undefined) a.category = input.category;
  if (input.author !== undefined) a.author = input.author;
  if (input.summary !== undefined) a.summary = input.summary;
  if (input.content !== undefined) a.content = input.content;
  if (input.keywords !== undefined) a.keywords = input.keywords;
  if (input.featured !== undefined) a.featured = input.featured;
  if (input.status !== undefined) {
    a.status = input.status;
    if (input.status === "Published" && !a.publishedAt) a.publishedAt = new Date();
  }
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.updated", entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return view(a);
}

export async function setStatus(auth: AuthContext, id: string, status: KbStatus, ip: string | null): Promise<ArticleView> {
  const a = await requireWritableArticle(auth, id);
  a.status = status;
  if (status === "Published" && !a.publishedAt) a.publishedAt = new Date();
  await a.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `kb.${status.toLowerCase()}`, entityType: "KbArticle", entityId: a.id, sourceIp: ip, result: "Success" });
  return view(a);
}

export async function vote(auth: AuthContext, id: string, helpful: boolean): Promise<ArticleView> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  await assertCanReadArticle(auth, a); // any reader of a visible article may vote
  if (helpful) a.helpful += 1;
  else a.notHelpful += 1;
  await a.save();
  return view(a);
}

export async function deleteArticle(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const a = await requireWritableArticle(auth, id);
  await a.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.deleted", entityType: "KbArticle", entityId: id, sourceIp: ip, result: "Success" });
}
