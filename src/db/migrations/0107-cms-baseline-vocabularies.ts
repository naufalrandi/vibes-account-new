import type { Migration } from "../migrate";

/**
 * OD's CMS vocabularies, ported verbatim:
 *   `CMS_PAGE_STATUS` = ['Draft','In Review','Published','Archived']  (js/core.js:3742)
 *   `CMS_POST_STATUS` = ['Draft','In Review','Scheduled','Published','Archived'] (:3743)
 *   `CMS_TEMPLATES`   = ['Landing','Standard','Pricing','Contact','Blog Index','Legal'] (:3744)
 *
 * The backend spelled the review state "InReview" with no space, while
 * fe-vibes-new (app/(app)/platform/website-cms/cms-shared.tsx:23) already used
 * OD's spaced literal — so a backend-seeded page did not match the frontend's
 * own draft filter (EnterpriseWebsiteCmsPage.tsx:194) and rendered no label.
 *
 * The template list was also missing 'Standard', 'Blog Index' and 'Legal' and
 * carried a 'Home' that OD does not define. Because 'Standard' had nowhere to
 * go, the seeder remapped five of OD's eight pages onto 'Landing', so the Pages
 * list showed 6 Landing where OD shows 1 Landing + 5 Standard.
 *
 * Both columns are plain STRING (migration 0079), so only stored values move.
 */
export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`UPDATE "cms_pages" SET "status" = 'In Review' WHERE "status" = 'InReview'`);
  await s.query(`UPDATE "cms_posts" SET "status" = 'In Review' WHERE "status" = 'InReview'`);
  await s.query(`UPDATE "cms_pages" SET "template" = 'Landing' WHERE "template" = 'Home'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`UPDATE "cms_pages" SET "status" = 'InReview' WHERE "status" = 'In Review'`);
  await s.query(`UPDATE "cms_posts" SET "status" = 'InReview' WHERE "status" = 'In Review'`);
};
