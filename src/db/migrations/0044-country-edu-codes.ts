import type { Migration } from "../migrate";
import { EDU_FRAMEWORK_SEED } from "../../modules/reference-db/data/eduFrameworkSeed";

/**
 * Backfill for two related D-7.5/D-12 gap fixes (OD `index.html:16786-16804`):
 *
 * 1. `ReferenceCountry.eduFramework`/`eduLevels` were never seeded for the 7
 *    countries OD ships national qualification frameworks for (ID KKNI, AU
 *    AQF, GB RQF, MY MQF, IE NFQ, SG SGUS, ZA NQF) — `referenceDb.service.ts`
 *    hard-coded `eduFramework: null, eduLevels: []` for every country.
 * 2. The `eduLevels` JSONB rows also gained a `code` field (the national
 *    qualification code, e.g. "Jenjang 6" — OD's `level` string) alongside
 *    the existing numeric `level` (kept for ordering) and `isced` fields.
 *
 * `ensureCountriesSeeded` only seeds a fresh org's countries on first read,
 * so orgs already provisioned before this fix would never pick up either
 * change. This migration re-seeds `eduFramework`/`eduLevels` in place for
 * every existing `reference_countries` row that matches one of the 7 codes
 * and hasn't had its education levels customized yet (`edu_levels = '[]'`),
 * mirroring OD's own guard (`if(!(c.eduLevels||[]).length)`, 16786/16803).
 * Rows an admin already edited are left untouched.
 */
export const up: Migration = async ({ context: q }) => {
  for (const country of EDU_FRAMEWORK_SEED) {
    const levels = country.levels.map((l) => ({ level: l.isced, code: l.code, label: l.label, isced: String(l.isced) }));
    await q.sequelize.query(
      `UPDATE "reference_countries"
       SET "edu_framework" = :framework, "edu_levels" = :levels::jsonb
       WHERE "code" = :code AND ("edu_levels" IS NULL OR "edu_levels" = '[]'::jsonb)`,
      { replacements: { framework: country.framework, levels: JSON.stringify(levels), code: country.code } },
    );
  }
};

export const down: Migration = async ({ context: q }) => {
  const codes = EDU_FRAMEWORK_SEED.map((c) => c.code);
  await q.sequelize.query(
    `UPDATE "reference_countries" SET "edu_framework" = NULL, "edu_levels" = '[]'::jsonb
     WHERE "code" IN (:codes) AND "edited" = false`,
    { replacements: { codes } },
  );
};
