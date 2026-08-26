import { Op, type WhereOptions } from "sequelize";
import { CmsPage } from "../../db/models";
import type { CmsPageStatus, CmsPageTemplate } from "../../db/models/cms.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface PageInput {
  title: string;
  slug?: string;
  path?: string | null;
  template?: CmsPageTemplate;
  status?: CmsPageStatus;
  author?: string | null;
  seoTitle?: string | null;
  seoDesc?: string | null;
  body?: string;
}

async function orgWhere(auth: AuthContext): Promise<WhereOptions> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

async function assertUniqueSlug(orgId: string, slug: string, excludeId?: string): Promise<void> {
  const existing = await CmsPage.findOne({ where: { orgId, slug } });
  if (existing && existing.id !== excludeId) throw new ConflictError("Slug already in use", "SLUG_TAKEN");
}

export async function listPages(auth: AuthContext, filters: { status?: CmsPageStatus } = {}): Promise<CmsPage[]> {
  const where: WhereOptions = { ...(await orgWhere(auth)) };
  if (filters.status) Object.assign(where, { status: filters.status });
  return CmsPage.findAll({ where, order: [["createdAt", "DESC"]] });
}

async function requirePage(auth: AuthContext, id: string): Promise<CmsPage> {
  const p = await CmsPage.findByPk(id);
  if (!p) throw new NotFoundError("Page does not exist", "PAGE_NOT_FOUND");
  await assertCanSeeOrg(auth, p.orgId);
  return p;
}

export async function getPage(auth: AuthContext, id: string): Promise<CmsPage> {
  return requirePage(auth, id);
}

export async function createPage(auth: AuthContext, input: PageInput, ip: string | null): Promise<CmsPage> {
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  const slug = slugify(input.slug ?? input.title);
  await assertUniqueSlug(auth.orgId, slug);
  const p = await CmsPage.create({
    orgId: auth.orgId,
    title: input.title.trim(),
    slug,
    path: input.path ?? null,
    template: input.template ?? "Landing",
    status: input.status ?? "Draft",
    author: input.author ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDesc: input.seoDesc ?? null,
    body: input.body ?? "",
    createdBy: auth.userId,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.page.created", entityType: "CmsPage", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export async function updatePage(auth: AuthContext, id: string, input: Partial<PageInput>, ip: string | null): Promise<CmsPage> {
  const p = await requirePage(auth, id);
  if (input.title !== undefined) p.title = input.title.trim();
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    await assertUniqueSlug(p.orgId, slug, p.id);
    p.slug = slug;
  }
  if (input.path !== undefined) p.path = input.path;
  if (input.template !== undefined) p.template = input.template;
  if (input.author !== undefined) p.author = input.author;
  if (input.seoTitle !== undefined) p.seoTitle = input.seoTitle;
  if (input.seoDesc !== undefined) p.seoDesc = input.seoDesc;
  if (input.body !== undefined) p.body = input.body;
  if (input.status !== undefined) p.status = input.status;
  await p.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.page.updated", entityType: "CmsPage", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export async function setStatus(auth: AuthContext, id: string, status: CmsPageStatus, ip: string | null): Promise<CmsPage> {
  const p = await requirePage(auth, id);
  p.status = status;
  await p.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `cms.page.${status.toLowerCase()}`, entityType: "CmsPage", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export const publishPage = (auth: AuthContext, id: string, ip: string | null): Promise<CmsPage> => setStatus(auth, id, "Published", ip);
export const archivePage = (auth: AuthContext, id: string, ip: string | null): Promise<CmsPage> => setStatus(auth, id, "Archived", ip);
