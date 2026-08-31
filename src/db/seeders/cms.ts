/**
 * SOF-336 — seeds OD's marketing CMS demo content (`db.cmsPages`,
 * `db.cmsPosts`, `db.cmsMedia`, `db.cmsMenu`) into the AXIA ServiceOwner org.
 * Data is `cms.data.ts`, transcribed verbatim from `cmsSeedIfNeeded()`
 * (open-design core.js:3750-3789).
 *
 * Idempotency: upsert by natural key — pages/posts by `(orgId, slug)`,
 * media by `(orgId, name)`, menu items by `(orgId, label)`. `cmsMenu[].target`
 * is an OD page id string; resolved here to the real `CmsPage.id` created in
 * the same run.
 */
import { CmsMedia, CmsMenuItem, CmsPage, CmsPost } from "../models";
import { CMS_MEDIA, CMS_MENU, CMS_PAGES, CMS_POSTS } from "./cms.data";

const AUTHOR_FALLBACK = "System";

export async function seedCms(orgId: string): Promise<void> {
  const pageIdByOdId = new Map<string, string>();
  for (const p of CMS_PAGES) {
    const [row] = await CmsPage.findOrCreate({
      where: { orgId, slug: p.slug },
      defaults: {
        orgId, title: p.title, slug: p.slug, path: p.path, template: p.template, status: p.status,
        author: p.author, seoTitle: p.seoTitle, seoDesc: p.seoDesc, body: p.body, createdBy: p.author,
      },
    });
    pageIdByOdId.set(p.odId, row.id);
  }

  for (const p of CMS_POSTS) {
    await CmsPost.findOrCreate({
      where: { orgId, slug: p.slug },
      defaults: {
        orgId, title: p.title, slug: p.slug, author: p.author, category: p.category, tags: p.tags,
        status: p.status, excerpt: p.excerpt, body: p.body,
        publishDate: p.publishDate ? new Date(p.publishDate) : null, createdBy: p.author,
      },
    });
  }

  for (const m of CMS_MEDIA) {
    await CmsMedia.findOrCreate({
      where: { orgId, name: m.name },
      defaults: {
        orgId, name: m.name, type: m.type, alt: m.alt, size: m.size,
        url: `/uploads/cms/${orgId}/${m.name}`, uploadedAt: new Date(m.uploadedAt), createdBy: AUTHOR_FALLBACK,
      },
    });
  }

  for (const [order, mi] of CMS_MENU.entries()) {
    await CmsMenuItem.findOrCreate({
      where: { orgId, label: mi.label },
      defaults: { orgId, label: mi.label, pageId: pageIdByOdId.get(mi.target) ?? null, url: null, order },
    });
  }
}
