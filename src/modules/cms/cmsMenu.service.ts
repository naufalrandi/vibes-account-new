import { Op, type WhereOptions } from "sequelize";
import { CmsMenuItem, CmsPage } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface MenuItemInput {
  label: string;
  pageId?: string | null;
  url?: string | null;
  order?: number;
}

async function orgWhere(auth: AuthContext): Promise<WhereOptions> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

export async function listMenuItems(auth: AuthContext): Promise<CmsMenuItem[]> {
  const where = await orgWhere(auth);
  return CmsMenuItem.findAll({ where, order: [["order", "ASC"]] });
}

async function requireMenuItem(auth: AuthContext, id: string): Promise<CmsMenuItem> {
  const m = await CmsMenuItem.findByPk(id);
  if (!m) throw new NotFoundError("Menu item does not exist", "MENU_ITEM_NOT_FOUND");
  await assertCanSeeOrg(auth, m.orgId);
  return m;
}

async function assertTarget(auth: AuthContext, pageId?: string | null, url?: string | null): Promise<void> {
  if (!pageId && !url) throw new BadRequestError("A menu item needs a pageId or a url", "TARGET_REQUIRED");
  if (pageId) {
    const page = await CmsPage.findByPk(pageId);
    if (!page) throw new NotFoundError("Page does not exist", "PAGE_NOT_FOUND");
    await assertCanSeeOrg(auth, page.orgId);
  }
}

export async function createMenuItem(auth: AuthContext, input: MenuItemInput, ip: string | null): Promise<CmsMenuItem> {
  if (!input.label || !input.label.trim()) throw new BadRequestError("Label is required", "LABEL_REQUIRED");
  await assertTarget(auth, input.pageId, input.url);
  const m = await CmsMenuItem.create({
    orgId: auth.orgId,
    label: input.label.trim(),
    pageId: input.pageId ?? null,
    url: input.pageId ? null : (input.url ?? null),
    order: input.order ?? 0,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.menu.created", entityType: "CmsMenuItem", entityId: m.id, sourceIp: ip, result: "Success" });
  return m;
}

export async function updateMenuItem(auth: AuthContext, id: string, input: Partial<MenuItemInput>, ip: string | null): Promise<CmsMenuItem> {
  const m = await requireMenuItem(auth, id);
  if (input.label !== undefined) m.label = input.label.trim();
  if (input.pageId !== undefined || input.url !== undefined) {
    const pageId = input.pageId !== undefined ? input.pageId : m.pageId;
    const url = input.url !== undefined ? input.url : m.url;
    await assertTarget(auth, pageId, pageId ? null : url);
    m.pageId = pageId ?? null;
    m.url = pageId ? null : (url ?? null);
  }
  if (input.order !== undefined) m.order = input.order;
  await m.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.menu.updated", entityType: "CmsMenuItem", entityId: m.id, sourceIp: ip, result: "Success" });
  return m;
}

export async function deleteMenuItem(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const m = await requireMenuItem(auth, id);
  await m.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.menu.deleted", entityType: "CmsMenuItem", entityId: id, sourceIp: ip, result: "Success" });
}

/** Bulk reorder — `{id, order}[]` replaces one-at-a-time order edits. Only touches items the caller can see. */
export async function reorderMenuItems(auth: AuthContext, items: { id: string; order: number }[], ip: string | null): Promise<CmsMenuItem[]> {
  const updated: CmsMenuItem[] = [];
  for (const { id, order } of items) {
    const m = await requireMenuItem(auth, id);
    m.order = order;
    await m.save();
    updated.push(m);
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.menu.reordered", entityType: "CmsMenuItem", entityId: null, sourceIp: ip, result: "Success" });
  return updated;
}
