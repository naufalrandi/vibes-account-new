/**
 * OD marketing CMS seed content — verbatim from `cmsSeedIfNeeded()`
 * (open-design core.js:3750-3789): 8 pages, 4 posts, 5 media assets, 5 menu
 * items. OD's `d(n)` helper ("n days ago") is reproduced with a fixed
 * `NOW` anchor so the seed is deterministic across runs.
 *
 * SOF-336: `db.cmsPages`/`cmsPosts`/`cmsMedia`/`cmsMenu` had zero backend
 * rows after `migrate:fresh:seed` even though the `Cms*` models/migration
 * (0079-cms) exist — no seeder ever populated them. This file + `cms.ts`
 * close that gap.
 *
 * `CmsPageTemplate` (cms.model.ts) only has Home/Pricing/Contact/Landing —
 * OD's `'Standard'` template has no equivalent column value, so those pages
 * are remapped to `'Landing'` (closest generic template) here.
 */
const NOW = Date.parse("2026-05-15T09:00:00.000Z");
const d = (n: number) => new Date(NOW - n * 86400000).toISOString();
const AUTHOR = "System";

export const CMS_PAGES = [
  { odId: "PG-0001", title: "Home", slug: "home", template: "Landing" as const, status: "Published" as const, author: AUTHOR, seoTitle: "VIBES — One Platform for Every Management System", seoDesc: "Assessments, documents, audits, risk and certification workflows for ISO 9001, 27001, 45001 and beyond.", body: "# Run every management system in one place\n\nVIBES unifies framework implementation, competence, documents, audits, risk and certification into a single operating platform.\n\n- Multi-framework: ISO 9001, 27001, 45001, 17025, 17021, 17024\n- Asset-based information security risk assessment\n- Audit programmes, findings and management review", path: "/", updatedAt: d(3), createdAt: d(60) },
  { odId: "PG-0002", title: "Platform", slug: "platform", template: "Landing" as const, status: "Published" as const, author: AUTHOR, seoTitle: "The VIBES Platform", seoDesc: "A modular platform covering the full ISO management-system lifecycle.", body: "# The Platform\n\nFrom framework cross-reference to residual-risk monitoring, VIBES covers the full lifecycle.", path: "/platform", updatedAt: d(8), createdAt: d(58) },
  { odId: "PG-0003", title: "Solutions", slug: "solutions", template: "Landing" as const, status: "Published" as const, author: AUTHOR, seoTitle: "Solutions by Standard", seoDesc: "Purpose-built extensions per ISO standard.", body: "# Solutions\n\nFramework extensions for Quality, Health & Safety and Information Security.", path: "/solutions", updatedAt: d(12), createdAt: d(58) },
  { odId: "PG-0004", title: "Pricing", slug: "pricing", template: "Pricing" as const, status: "Published" as const, author: AUTHOR, seoTitle: "VIBES Pricing", seoDesc: "Simple per-workspace subscription pricing with bank-transfer billing.", body: "# Pricing\n\nPer-workspace subscriptions, billed per bundle. Bank transfer with manual verification.", path: "/pricing", updatedAt: d(5), createdAt: d(40) },
  { odId: "PG-0005", title: "About", slug: "about", template: "Landing" as const, status: "Published" as const, author: AUTHOR, seoTitle: "About VIBES", seoDesc: "Who we are and why we built VIBES.", body: "# About\n\nWe build software for certification-ready organizations.", path: "/about", updatedAt: d(20), createdAt: d(58) },
  { odId: "PG-0006", title: "Contact", slug: "contact", template: "Contact" as const, status: "Published" as const, author: AUTHOR, seoTitle: "Contact VIBES", seoDesc: "Talk to our team.", body: "# Contact\n\nRequest a demo or talk to sales.", path: "/contact", updatedAt: d(20), createdAt: d(58) },
  { odId: "PG-0007", title: "Security & Trust", slug: "security", template: "Landing" as const, status: "InReview" as const, author: AUTHOR, seoTitle: "Security & Trust", seoDesc: "How VIBES protects your data.", body: "# Security & Trust\n\nOur own ISMS, sub-processors and data-protection commitments.", path: "/security", updatedAt: d(1), createdAt: d(9) },
  { odId: "PG-0008", title: "Careers", slug: "careers", template: "Landing" as const, status: "Draft" as const, author: AUTHOR, seoTitle: "Careers at VIBES", seoDesc: "Join the team.", body: "# Careers\n\nOpen roles across engineering, product and customer success.", path: "/careers", updatedAt: d(2), createdAt: d(6) },
];

export const CMS_POSTS = [
  { odId: "PO-0001", title: "ISO/IEC 27001:2022 — what changed in Annex A", slug: "iso-27001-2022-annex-a", author: AUTHOR, category: "Standards", tags: ["ISO 27001", "InfoSec"], status: "Published" as const, excerpt: "The 2022 revision consolidates Annex A into 93 controls across four themes.", body: "The 2022 revision restructures Annex A into 93 controls under Organizational, People, Physical and Technological themes...", publishDate: d(14), updatedAt: d(14), createdAt: d(16) },
  { odId: "PO-0002", title: "Asset-based information security risk assessment, explained", slug: "asset-based-isra", author: AUTHOR, category: "Guides", tags: ["Risk", "ISO 27005"], status: "Published" as const, excerpt: "A practical walk-through of the ISO/IEC 27005 asset-based approach.", body: "Inherent risk, current risk after controls, target and actual residual risk — the four stages that drive treatment...", publishDate: d(6), updatedAt: d(6), createdAt: d(7) },
  { odId: "PO-0003", title: "Preparing for your Stage 1 certification audit", slug: "stage-1-audit-prep", author: AUTHOR, category: "Guides", tags: ["Certification", "Audit"], status: "Scheduled" as const, excerpt: "A checklist to get documentation-ready before Stage 1.", body: "Stage 1 focuses on readiness: documented information, scope, and internal audit evidence...", publishDate: new Date(NOW + 5 * 86400000).toISOString(), updatedAt: d(1), createdAt: d(3) },
  { odId: "PO-0004", title: "Why we built VIBES on a single data model", slug: "single-data-model", author: AUTHOR, category: "Product", tags: ["Product"], status: "Draft" as const, excerpt: "One framework engine, many standards.", body: "A shared framework cross-reference model lets one control satisfy many requirements...", publishDate: null, updatedAt: d(2), createdAt: d(2) },
];

export const CMS_MEDIA = [
  { odId: "MD-0001", name: "hero-dashboard.png", type: "Image", size: 284000, alt: "VIBES dashboard hero", uploadedAt: d(30) },
  { odId: "MD-0002", name: "logo-vibes.svg", type: "Icon", size: 8200, alt: "VIBES logo", uploadedAt: d(60) },
  { odId: "MD-0003", name: "og-default.png", type: "Image", size: 196000, alt: "Open Graph default card", uploadedAt: d(30) },
  { odId: "MD-0004", name: "whitepaper-isms.pdf", type: "Document", size: 1650000, alt: "ISMS whitepaper", uploadedAt: d(21) },
  { odId: "MD-0005", name: "product-tour.mp4", type: "Video", size: 24800000, alt: "2-minute product tour", uploadedAt: d(18) },
];

// `target` is the OD page odId the menu item points at (resolved to the
// created CmsPage's real id by the seeder — see cms.ts).
export const CMS_MENU = [
  { odId: "MN-1", label: "Platform", target: "PG-0002" },
  { odId: "MN-2", label: "Solutions", target: "PG-0003" },
  { odId: "MN-3", label: "Pricing", target: "PG-0004" },
  { odId: "MN-4", label: "About", target: "PG-0005" },
  { odId: "MN-5", label: "Contact", target: "PG-0006" },
];
