import { Op, type WhereOptions } from "sequelize";
import { CmsPost } from "../../db/models";
import type { CmsPostStatus } from "../../db/models/cms.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface PostInput {
  title: string;
  slug?: string;
  author?: string | null;
  category?: string | null;
  tags?: string[];
  status?: CmsPostStatus;
  excerpt?: string | null;
  body?: string;
  publishDate?: string | null;
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
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post";
}

async function assertUniqueSlug(orgId: string, slug: string, excludeId?: string): Promise<void> {
  const existing = await CmsPost.findOne({ where: { orgId, slug } });
  if (existing && existing.id !== excludeId) throw new ConflictError("Slug already in use", "SLUG_TAKEN");
}

export async function listPosts(auth: AuthContext, filters: { status?: CmsPostStatus } = {}): Promise<CmsPost[]> {
  const where: WhereOptions = { ...(await orgWhere(auth)) };
  if (filters.status) Object.assign(where, { status: filters.status });
  return CmsPost.findAll({ where, order: [["createdAt", "DESC"]] });
}

async function requirePost(auth: AuthContext, id: string): Promise<CmsPost> {
  const p = await CmsPost.findByPk(id);
  if (!p) throw new NotFoundError("Post does not exist", "POST_NOT_FOUND");
  await assertCanSeeOrg(auth, p.orgId);
  return p;
}

export async function getPost(auth: AuthContext, id: string): Promise<CmsPost> {
  return requirePost(auth, id);
}

export async function createPost(auth: AuthContext, input: PostInput, ip: string | null): Promise<CmsPost> {
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  const slug = slugify(input.slug ?? input.title);
  await assertUniqueSlug(auth.orgId, slug);
  const p = await CmsPost.create({
    orgId: auth.orgId,
    title: input.title.trim(),
    slug,
    author: input.author ?? null,
    category: input.category ?? null,
    tags: input.tags ?? [],
    status: input.status ?? "Draft",
    excerpt: input.excerpt ?? null,
    body: input.body ?? "",
    publishDate: input.publishDate ? new Date(input.publishDate) : null,
    createdBy: auth.userId,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.post.created", entityType: "CmsPost", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export async function updatePost(auth: AuthContext, id: string, input: Partial<PostInput>, ip: string | null): Promise<CmsPost> {
  const p = await requirePost(auth, id);
  if (input.title !== undefined) p.title = input.title.trim();
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    await assertUniqueSlug(p.orgId, slug, p.id);
    p.slug = slug;
  }
  if (input.author !== undefined) p.author = input.author;
  if (input.category !== undefined) p.category = input.category;
  if (input.tags !== undefined) p.tags = input.tags;
  if (input.excerpt !== undefined) p.excerpt = input.excerpt;
  if (input.body !== undefined) p.body = input.body;
  if (input.publishDate !== undefined) p.publishDate = input.publishDate ? new Date(input.publishDate) : null;
  if (input.status !== undefined) p.status = input.status;
  await p.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.post.updated", entityType: "CmsPost", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export async function setStatus(auth: AuthContext, id: string, status: CmsPostStatus, ip: string | null): Promise<CmsPost> {
  const p = await requirePost(auth, id);
  p.status = status;
  await p.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `cms.post.${status.toLowerCase()}`, entityType: "CmsPost", entityId: p.id, sourceIp: ip, result: "Success" });
  return p;
}

export const publishPost = (auth: AuthContext, id: string, ip: string | null): Promise<CmsPost> => setStatus(auth, id, "Published", ip);
export const archivePost = (auth: AuthContext, id: string, ip: string | null): Promise<CmsPost> => setStatus(auth, id, "Archived", ip);

/** True once a post is publicly visible: Published, or Scheduled with `publishDate` in the past. */
export function isPubliclyVisible(post: Pick<CmsPost, "status" | "publishDate">): boolean {
  if (post.status === "Published") return true;
  if (post.status === "Scheduled" && post.publishDate) return post.publishDate.getTime() <= Date.now();
  return false;
}
