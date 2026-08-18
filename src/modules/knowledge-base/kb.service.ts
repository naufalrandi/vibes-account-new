import { Op, cast, col, where as sqlWhere, type WhereOptions } from "sequelize";
import { KbArticle } from "../../db/models";
import type { KbStatus } from "../../db/models/kbArticle.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * The fixed KB category catalog (KB_CATEGORIES). Descriptions mirror the FE's
 * `lib/api/types.ts` KB_CATEGORIES constant (the authoritative source — see
 * the OD→FE/BE gap analysis §2.5 "kb"); OD's own text ("Release Notes: What's
 * new in VIBES.") is superseded by the FE's AXIA-branded rename, which this
 * catalog must agree with rather than carry a third, independent wording.
 */
export const KB_CATEGORIES: { id: string; name: string; desc: string }[] = [
  { id: "platform", name: "Platform Guides", desc: "Getting started and day-to-day platform tasks." },
  { id: "framework", name: "Framework Guides", desc: "Working with frameworks, requirements, and elements." },
  { id: "billing", name: "Billing", desc: "Subscriptions, invoices, payments, and receipts." },
  { id: "partner", name: "Partner Program", desc: "Partner tiers, revenue share, and onboarding." },
  { id: "troubleshooting", name: "Troubleshooting", desc: "Fixes for common issues." },
  { id: "faq", name: "FAQs", desc: "Frequently asked questions." },
  { id: "release", name: "Release Notes", desc: "What's new in AXIA." },
];
const CAT_NAME: Record<string, string> = Object.fromEntries(KB_CATEGORIES.map((c) => [c.id, c.name]));

type KbVote = "helpful" | "notHelpful";

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

/**
 * KB-specific visibility scope (P0-4 / B1 fix).
 *
 * `visibleTenantOrgIds` (site.service.ts:61-67) returns a Distributor's CHILD
 * tenant ids and EXCLUDES the Distributor's own org — correct for
 * site/billing tenancy, but wrong for KB: OD's Knowledge Base is a single
 * SP-managed global library and org-scoped articles are an FE/BE-only
 * extension, so the only sane containment is "own org, nothing else" — a
 * Distributor must never see or write a child tenant's org-scoped articles,
 * and must always see its own. Returns null for ServiceOwner (unrestricted).
 */
function kbVisibleOrgIds(auth: AuthContext): string[] | null {
  return auth.orgType === "ServiceOwner" ? null : [auth.orgId];
}

/** Articles the actor may see: global (org_id NULL) + own-org; non-SO sees only Published globals. */
function scopeWhere(auth: AuthContext): WhereOptions {
  const ids = kbVisibleOrgIds(auth); // null = ServiceOwner (unrestricted)
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
  const where: WhereOptions = { ...scopeWhere(auth) };
  if (filters.category) Object.assign(where, { category: filters.category });
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.search) {
    // OD `kbMatch` (index.html:15683) matches title, summary, content, and
    // keywords (plus the category display name, which the FE layers on
    // client-side since it isn't a stored column here). `keywords` is a JSONB
    // array — cast it to text so a substring search still reaches it.
    const term = `%${filters.search}%`;
    Object.assign(where, {
      [Op.and]: [{
        [Op.or]: [
          { title: { [Op.iLike]: term } },
          { summary: { [Op.iLike]: term } },
          { content: { [Op.iLike]: term } },
          sqlWhere(cast(col("keywords"), "text"), { [Op.iLike]: term }),
        ],
      }],
    });
  }
  const rows = await KbArticle.findAll({ where, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

/** Read scope: SO → any; others → own-org articles or published globals. */
function assertCanReadArticle(auth: AuthContext, a: KbArticle): void {
  const ids = kbVisibleOrgIds(auth); // null = ServiceOwner (unrestricted)
  if (ids === null) return;
  const ownedByVisible = a.orgId !== null && ids.includes(a.orgId);
  const globalPublished = a.orgId === null && a.status === "Published";
  if (!ownedByVisible && !globalPublished) throw new ForbiddenError();
}

/** Write scope: SO → any; others → own-org only (never a global, parent, or child org's article). */
async function requireWritableArticle(auth: AuthContext, id: string): Promise<KbArticle> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  const ids = kbVisibleOrgIds(auth);
  if (ids !== null && (a.orgId === null || !ids.includes(a.orgId))) throw new ForbiddenError();
  return a;
}

/**
 * KB authoring is a Service-Owner platform control (P0-6 / B2 fix). OD gates
 * every authoring surface on the SP view (index.html:15726) — its Knowledge
 * Base has no org-scoped self-authoring concept at all. Applied at the top of
 * every mutating entry point, ahead of `requireWritableArticle`'s own-org
 * check, which stays in place underneath as defense-in-depth.
 */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner authors knowledge base articles");
}

export async function getArticle(auth: AuthContext, id: string, track: boolean): Promise<ArticleView> {
  const a = await KbArticle.findByPk(id);
  if (!a) throw new NotFoundError("Article does not exist", "ARTICLE_NOT_FOUND");
  assertCanReadArticle(auth, a);
  if (track) {
    a.views += 1;
    // B4: only the first view per user grows uniqueViews. Reassign (not
    // push) so Sequelize's dirty-checking sees the JSONB column change.
    if (!a.viewerIds.includes(auth.userId)) {
      a.viewerIds = [...a.viewerIds, auth.userId];
      a.uniqueViews += 1;
    }
    await a.save();
  }
  return view(a);
}

export async function createArticle(auth: AuthContext, input: ArticleInput, ip: string | null): Promise<ArticleView> {
  assertServiceOwner(auth);
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  if (!input.category) throw new BadRequestError("Category is required", "CATEGORY_REQUIRED");
  const status = input.status ?? "Draft";
  const a = await KbArticle.create({
    orgId: null, // Authoring is Service-Owner only now, so every article is global.
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
  assertServiceOwner(auth);
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
  assertServiceOwner(auth);
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
  assertCanReadArticle(auth, a); // any reader of a visible article may vote
  // B4: dedupe by voter — a repeat vote is a no-op, a changed vote moves the
  // count instead of double-adding. Reassign the map (not a keyed mutation)
  // so Sequelize's dirty-checking sees the JSONB column change.
  const next: KbVote = helpful ? "helpful" : "notHelpful";
  const prior = a.voterIds[auth.userId];
  if (prior !== next) {
    if (prior === "helpful") a.helpful = Math.max(0, a.helpful - 1);
    if (prior === "notHelpful") a.notHelpful = Math.max(0, a.notHelpful - 1);
    if (next === "helpful") a.helpful += 1;
    else a.notHelpful += 1;
    a.voterIds = { ...a.voterIds, [auth.userId]: next };
  }
  await a.save();
  return view(a);
}

export async function deleteArticle(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const a = await requireWritableArticle(auth, id);
  await a.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "kb.deleted", entityType: "KbArticle", entityId: id, sourceIp: ip, result: "Success" });
}
