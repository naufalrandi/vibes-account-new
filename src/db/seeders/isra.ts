import {
  IsraAnnexAControl,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraPaGroup,
  IsraPaSubgroup,
  IsraSaGroup,
  IsraSaSubgroup,
  IsraPrimaryAssetLibrary,
  IsraSecondaryAssetLibrary,
  IsraKmSaThreat,
  IsraKmThreatVuln,
  IsraKmVulnControl,
  IsraKmMeta,
  IsraTreatTemplate,
} from "../models";
import { ISRA_ANNEXA_SEED } from "./isra.annexA.data";
import { ISRA_THREAT_LIBRARY_SEED } from "./isra.threatLibrary.data";
import { ISRA_VULN_LIBRARY_SEED } from "./isra.vulnLibrary.data";
import { ISRA_KM_SA_THREAT_SEED, type IsraKmSaThreatSeedRow } from "./isra.kmSaThreat.data";
import { ISRA_KM_THREAT_VULN_SEED, type IsraKmThreatVulnSeedRow } from "./isra.kmThreatVuln.data";
import { ISRA_KM_VULN_CONTROL_SEED } from "./isra.kmVulnControl.data";
import { ISRA_TREAT_TEMPLATES_SEED } from "./isra.treatTemplates.data";
import {
  ISRA_PA_GROUP_SEED,
  ISRA_PA_SUBGROUP_SEED,
  ISRA_SA_GROUP_SEED,
  ISRA_SA_SUBGROUP_SEED,
  ISRA_PRIMARY_ASSET_SEED,
  ISRA_SECONDARY_ASSET_SEED,
} from "./isra.assetTaxonomy.data";

/**
 * ISRA + SoA (F-2b) — global reference-library seed: the 93-row Annex A
 * master, Threat/Vuln libraries, the Primary/Secondary asset taxonomy and
 * its asset libraries, the re-derived V2 knowledge maps (SA-subgroup→Threat,
 * Threat→Vuln), the 1,950-row Vuln→Annex A map, the generic RTP treatment
 * templates, and the KM publish-state singleton.
 *
 * All of these are GLOBAL reference tables (no org_id) — same seeding shape
 * as `seedComplianceEngine()`: idempotent upsert by natural/business key, so
 * re-running converges existing rows to the source data without duplicating.
 * Every table uses one `bulkCreate({ updateOnDuplicate })` round trip instead
 * of row-by-row `findOrCreate` — ~1,200 rows across these tables would
 * otherwise mean ~1,200 sequential network round trips to a remote database.
 *
 * `isra_km_sa_threat`/`isra_km_threat_vuln` carry FKs into
 * `isra_sa_subgroups`/`isra_sa_groups`. `seedAssetTaxonomy()` below now fills
 * those tables from OD in the same pass and runs FIRST, so the partition
 * guard should never skip a row. The guard stays because it is the only thing
 * that turns a taxonomy gap into a loud warning instead of an FK crash mid-seed;
 * a non-zero `skipped` after this ordering means the taxonomy data itself has
 * drifted from the KM data, which is worth failing loudly on.
 */

async function seedAnnexA(): Promise<void> {
  await IsraAnnexAControl.bulkCreate(
    ISRA_ANNEXA_SEED.map((spec) => ({ ...spec, description: null })),
    { updateOnDuplicate: ["name", "category", "csf", "type", "fnP", "fnD", "fnC", "dedL", "dedC"] },
  );
}

async function seedThreatLibrary(): Promise<void> {
  await IsraThreatLibrary.bulkCreate([...ISRA_THREAT_LIBRARY_SEED], { updateOnDuplicate: ["name", "category", "description", "status"] });
}

async function seedVulnLibrary(): Promise<void> {
  await IsraVulnLibrary.bulkCreate([...ISRA_VULN_LIBRARY_SEED], { updateOnDuplicate: ["name", "category", "description", "status"] });
}

/**
 * The asset taxonomy: Primary/Secondary asset Group→Subgroup trees and the
 * seeded asset libraries hanging off them. OD's own ids are preserved
 * (`PAG-`/`PSG-`/`SAG-`/`SSG-`/`PAL-`/`SAL-`) because the knowledge maps
 * reference subgroups by exactly those strings.
 *
 * Groups go before subgroups, and both go before the libraries, so every FK
 * target exists when its referrer is written.
 */
async function seedAssetTaxonomy(): Promise<{ paGroups: number; paSubgroups: number; saGroups: number; saSubgroups: number; primary: number; secondary: number }> {
  await IsraPaGroup.bulkCreate([...ISRA_PA_GROUP_SEED], { updateOnDuplicate: ["name"] });
  await IsraSaGroup.bulkCreate([...ISRA_SA_GROUP_SEED], { updateOnDuplicate: ["name"] });

  await IsraPaSubgroup.bulkCreate(
    ISRA_PA_SUBGROUP_SEED.map((spec) => ({ ...spec, examples: [...spec.examples] })),
    { updateOnDuplicate: ["groupId", "name", "description", "examples"] },
  );
  await IsraSaSubgroup.bulkCreate(
    ISRA_SA_SUBGROUP_SEED.map((spec) => ({ ...spec, examples: [...spec.examples] })),
    { updateOnDuplicate: ["groupId", "name", "description", "examples", "status", "version"] },
  );

  await IsraPrimaryAssetLibrary.bulkCreate(
    ISRA_PRIMARY_ASSET_SEED.map((spec) => ({ ...spec, cia: { ...spec.cia }, typicalSecondary: [...spec.typicalSecondary] })),
    { updateOnDuplicate: ["name", "category", "groupId", "subgroupId", "cia", "privacy", "typicalSecondary"] },
  );
  await IsraSecondaryAssetLibrary.bulkCreate([...ISRA_SECONDARY_ASSET_SEED], {
    updateOnDuplicate: ["name", "groupId", "subgroupId", "description"],
  });

  return {
    paGroups: ISRA_PA_GROUP_SEED.length,
    paSubgroups: ISRA_PA_SUBGROUP_SEED.length,
    saGroups: ISRA_SA_GROUP_SEED.length,
    saSubgroups: ISRA_SA_SUBGROUP_SEED.length,
    primary: ISRA_PRIMARY_ASSET_SEED.length,
    secondary: ISRA_SECONDARY_ASSET_SEED.length,
  };
}

/** Subgroup ids that currently exist — used to skip KM rows whose taxonomy
 * FK target hasn't been seeded yet. */
async function existingSubgroupIds(): Promise<Set<string>> {
  const rows = await IsraSaSubgroup.findAll({ attributes: ["id"] });
  return new Set(rows.map((r) => r.id));
}

/** Splits KM rows into those whose `subgroupId` FK target already exists
 * (safe to write) and a count of those that don't (skipped, not guessed). */
function partitionBySubgroup<T extends { subgroupId: string }>(rows: readonly T[], known: Set<string>): { ready: T[]; skipped: number } {
  const ready: T[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (known.has(r.subgroupId)) ready.push(r);
    else skipped++;
  }
  return { ready, skipped };
}

async function seedKmSaThreat(knownSubgroups: Set<string>): Promise<{ seeded: number; skipped: number }> {
  const { ready, skipped } = partitionBySubgroup<IsraKmSaThreatSeedRow>(ISRA_KM_SA_THREAT_SEED, knownSubgroups);
  if (ready.length) {
    await IsraKmSaThreat.bulkCreate(
      ready.map((spec) => ({ ...spec, sources: [...spec.sources] })),
      { updateOnDuplicate: ["subgroupId", "groupId", "threatId", "sources"] },
    );
  }
  return { seeded: ready.length, skipped };
}

async function seedKmThreatVuln(knownSubgroups: Set<string>): Promise<{ seeded: number; skipped: number }> {
  const { ready, skipped } = partitionBySubgroup<IsraKmThreatVulnSeedRow>(ISRA_KM_THREAT_VULN_SEED, knownSubgroups);
  if (ready.length) {
    await IsraKmThreatVuln.bulkCreate(
      ready.map((spec) => ({ ...spec, sources: [...spec.sources] })),
      { updateOnDuplicate: ["subgroupId", "groupId", "threatId", "vulnId", "sources"] },
    );
  }
  return { seeded: ready.length, skipped };
}

async function seedKmVulnControl(): Promise<void> {
  await IsraKmVulnControl.bulkCreate(
    ISRA_KM_VULN_CONTROL_SEED.map((spec) => ({ ...spec, references: [...spec.references], comments: [] })),
    { updateOnDuplicate: ["vulnId", "annexRef", "role", "affects", "strength", "mechanism", "references", "status", "version", "source", "reviewer", "reviewDate"] },
  );
}

/** `isra_treat_templates.id` is a generated UUID (migration 0061), not a
 * business-key string — upsert by the natural (vulnId, annexRef) pair
 * instead of a PK-conflict bulk upsert. Only 3 seed rows, so the per-row
 * round trip cost is negligible. */
async function seedTreatTemplates(): Promise<void> {
  for (const spec of ISRA_TREAT_TEMPLATES_SEED) {
    const [row] = await IsraTreatTemplate.findOrCreate({
      where: { vulnId: spec.vulnId, annexRef: spec.annexRef },
      defaults: { vulnId: spec.vulnId, annexRef: spec.annexRef, actionTemplate: spec.actionTemplate, mechanism: spec.mechanism, notes: spec.notes },
    });
    let dirty = false;
    for (const k of ["actionTemplate", "mechanism", "notes"] as const) {
      if (row[k] !== spec[k]) {
        row[k] = spec[k];
        dirty = true;
      }
    }
    if (dirty) await row.save();
  }
}

/** Ensures the singleton KM publish-state row exists. This fresh seed
 * represents OD's own steady-state (`_israMapMeta` promoted to Approved by
 * OD's own post-install migration, `app.html:20913`) — published, v1. */
async function ensureKmMeta(): Promise<void> {
  const count = await IsraKmMeta.count();
  if (count > 0) return;
  await IsraKmMeta.create({ version: 1, status: "Published", publishedAt: new Date(), publishedBy: "system" });
}

export interface SeedIsraLibraryResult {
  annexA: number;
  threats: number;
  vulns: number;
  taxonomy: { paGroups: number; paSubgroups: number; saGroups: number; saSubgroups: number; primary: number; secondary: number };
  kmSaThreat: { seeded: number; skipped: number };
  kmThreatVuln: { seeded: number; skipped: number };
  kmVulnControl: number;
  treatTemplates: number;
}

export async function seedIsraLibrary(): Promise<SeedIsraLibraryResult> {
  await seedAnnexA();
  await seedThreatLibrary();
  await seedVulnLibrary();
  // Before the KM seeds: they FK into the subgroups this creates.
  const taxonomy = await seedAssetTaxonomy();
  await seedKmVulnControl();
  await seedTreatTemplates();
  await ensureKmMeta();

  const knownSubgroups = await existingSubgroupIds();
  const kmSaThreat = await seedKmSaThreat(knownSubgroups);
  const kmThreatVuln = await seedKmThreatVuln(knownSubgroups);
  if (kmSaThreat.skipped || kmThreatVuln.skipped) {
    // eslint-disable-next-line no-console
    console.warn(
      `[seedIsraLibrary] skipped ${kmSaThreat.skipped} isra_km_sa_threat and ${kmThreatVuln.skipped} isra_km_threat_vuln rows — ` +
        `their subgroup id(s) are not in isra_sa_subgroups. seedAssetTaxonomy() runs first, so this means the ` +
        `taxonomy data and the knowledge-map data have drifted apart — regenerate both with fe-vibes-new/tools/regen-od-data.cjs.`,
    );
  }

  return {
    annexA: ISRA_ANNEXA_SEED.length,
    threats: ISRA_THREAT_LIBRARY_SEED.length,
    vulns: ISRA_VULN_LIBRARY_SEED.length,
    taxonomy,
    kmSaThreat,
    kmThreatVuln,
    kmVulnControl: ISRA_KM_VULN_CONTROL_SEED.length,
    treatTemplates: ISRA_TREAT_TEMPLATES_SEED.length,
  };
}
