import { Router, type Request, type Response, type NextFunction } from "express";
import { Op } from "sequelize";
import { Organization, CmsPage, CmsPost } from "../../db/models";
import type { CmsPageTemplate } from "../../db/models/cms.model";
import { isPubliclyVisible } from "./cmsPost.service";
import { NotFoundError } from "../../lib/errors";

// PUBLIC router — mounted at /v1/public/cms WITHOUT authenticate/tenantScope.
// Reads Published-status rows only; never returns Draft/Archived content or
// another org's data. `orgId` is validated against a real organization first
// (404 otherwise) so this can't be used to probe for org ids.

export const cmsPublicRoutes = Router();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

async function requireOrg(orgId: string): Promise<Organization> {
  const org = await Organization.findByPk(orgId);
  if (!org) throw new NotFoundError("Site not found", "SITE_NOT_FOUND");
  return org;
}

async function findPublishedPage(orgId: string, slug: string): Promise<CmsPage | null> {
  const normalized = slug === "" || slug === "home" ? null : slug;
  if (normalized === null) {
    // Home: a page explicitly slugged "home", else the org's Home-template page.
    return (
      (await CmsPage.findOne({ where: { orgId, status: "Published", slug: "home" } })) ??
      (await CmsPage.findOne({ where: { orgId, status: "Published", template: "Home" } }))
    );
  }
  return CmsPage.findOne({ where: { orgId, status: "Published", slug: normalized } });
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
${body}
</body>
</html>`;
}

// Each renderer is small and real: distinct markup per template, not a
// shared stub with a label swapped in.
function renderHome(page: CmsPage): string {
  return layout(page.seoTitle ?? page.title, `
<header class="hero"><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.seoDesc ?? "")}</p></header>
<main class="home-body">${page.body}</main>`);
}

function renderPricing(page: CmsPage): string {
  return layout(page.seoTitle ?? page.title, `
<header><h1>${escapeHtml(page.title)}</h1></header>
<main class="pricing-grid" data-layout="pricing">${page.body}</main>
<footer class="pricing-cta"><a href="/contact">Talk to sales</a></footer>`);
}

function renderContact(page: CmsPage): string {
  return layout(page.seoTitle ?? page.title, `
<header><h1>${escapeHtml(page.title)}</h1></header>
<main class="contact-layout">
  <section class="contact-info">${page.body}</section>
  <form class="contact-form" method="post" action="/contact/submit">
    <input name="name" placeholder="Name" required>
    <input name="email" type="email" placeholder="Email" required>
    <textarea name="message" placeholder="Message" required></textarea>
    <button type="submit">Send</button>
  </form>
</main>`);
}

function renderLanding(page: CmsPage): string {
  return layout(page.seoTitle ?? page.title, `
<section class="landing-hero"><h1>${escapeHtml(page.title)}</h1></section>
<section class="landing-body">${page.body}</section>`);
}

const RENDERERS: Record<CmsPageTemplate, (page: CmsPage) => string> = {
  Home: renderHome,
  Pricing: renderPricing,
  Contact: renderContact,
  Landing: renderLanding,
};

cmsPublicRoutes.get("/:orgId/pages/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requireOrg(req.params.orgId as string);
    const page = await findPublishedPage(req.params.orgId as string, req.params.slug as string);
    if (!page) throw new NotFoundError("Page not found", "PAGE_NOT_FOUND");
    res.type("html").send(RENDERERS[page.template](page));
  } catch (e) {
    next(e);
  }
});

// JSON list of the org's publicly visible posts, newest first, optionally
// narrowed to one tag. The AXIA marketing site's News and Careers listings read
// through this (parity decision D-4: editable content comes from `cms`, not
// from hardcoded page copy) — they need the whole list, which the per-slug HTML
// route above cannot give them. JSON rather than HTML because the consumer is a
// React page that renders its own markup.
//
// Registered before `/:orgId/posts/:slug` so the bare collection path is not
// swallowed by the slug param.
cmsPublicRoutes.get("/:orgId/posts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.orgId as string;
    await requireOrg(orgId);
    const tag = typeof req.query.tag === "string" ? req.query.tag : null;
    const posts = await CmsPost.findAll({
      where: { orgId, ...(tag ? { tags: { [Op.contains]: [tag] } } : {}) },
      order: [["publishDate", "DESC"], ["createdAt", "DESC"]],
    });
    res.json(
      posts.filter(isPubliclyVisible).map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        author: p.author,
        category: p.category,
        tags: p.tags,
        excerpt: p.excerpt,
        body: p.body,
        publishDate: p.publishDate,
      })),
    );
  } catch (e) {
    next(e);
  }
});

// Not part of the mockup's explicit route list, but the "Scheduled becomes
// visible once publishDate passes" gap fix needs *some* public read path to
// apply that check against — a post's own page, by slug.
cmsPublicRoutes.get("/:orgId/posts/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.orgId as string;
    await requireOrg(orgId);
    const post = await CmsPost.findOne({ where: { orgId, slug: req.params.slug as string } });
    if (!post || !isPubliclyVisible(post)) throw new NotFoundError("Post not found", "POST_NOT_FOUND");
    res.type("html").send(layout(post.title, `<article><h1>${escapeHtml(post.title)}</h1>${post.body}</article>`));
  } catch (e) {
    next(e);
  }
});

cmsPublicRoutes.get("/:orgId/sitemap.xml", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.orgId as string;
    await requireOrg(orgId);
    const pages = await CmsPage.findAll({ where: { orgId, status: "Published" }, order: [["createdAt", "ASC"]] });
    const urls = pages
      .map((p) => `  <url><loc>/${p.path ?? p.slug}</loc><title>${escapeHtml(p.seoTitle ?? p.title)}</title></url>`)
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    res.type("application/xml").send(xml);
  } catch (e) {
    next(e);
  }
});

cmsPublicRoutes.get("/:orgId/robots.txt", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.orgId as string;
    await requireOrg(orgId);
    const sitemapUrl = `/v1/public/cms/${orgId}/sitemap.xml`;
    res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`);
  } catch (e) {
    next(e);
  }
});
