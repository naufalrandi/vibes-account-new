import { describe, expect, it, beforeAll } from "vitest";
import {
  initModels,
  IsraAnnexAControl,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraKmSaThreat,
  IsraKmThreatVuln,
  IsraKmVulnControl,
  IsraKmMeta,
  IsraTreatTemplate,
  IsraPaGroup,
  IsraPaSubgroup,
  IsraSaGroup,
  IsraSaSubgroup,
  IsraPrimaryAssetLibrary,
  IsraSecondaryAssetLibrary,
} from "../models";
import { seedIsraLibrary } from "./isra";
import { ISRA_ANNEXA_SEED } from "./isra.annexA.data";
import { ISRA_KM_VULN_CONTROL_SEED } from "./isra.kmVulnControl.data";
import { ISRA_KM_SA_THREAT_SEED } from "./isra.kmSaThreat.data";
import { ISRA_KM_THREAT_VULN_SEED } from "./isra.kmThreatVuln.data";

/**
 * ISRA + SoA (F-2b) — verifies the seed data derivation is correct, not just
 * that the seeder runs without throwing:
 *  - the 93-row Annex A master with P/D/C flags spot-checked against OD's
 *    `isra2DefProfile` type-based default (design doc §1, app.html:18140);
 *  - the 1,950-row `isra_km_vuln_control` map (269 curated CSV edges plus
 *    1,681 generated from OD's `ISRA_VULN_CTL_GEN`);
 *  - the Primary/Secondary asset taxonomy, which the seeder now writes
 *    itself, before the knowledge maps that FK into it;
 *  - the re-derived V2 knowledge maps (`isra_km_sa_threat`/
 *    `isra_km_threat_vuln`) — with the taxonomy seeded in the same pass,
 *    every row must now resolve, so a non-zero `skipped` means the taxonomy
 *    and KM datasets have drifted apart.
 *
 * Purely additive (findOrCreate/upsert by natural key) — never truncates,
 * safe to run repeatedly against a shared database.
 */
describe("ISRA reference-library seed (F-2b)", () => {
  beforeAll(() => initModels());

  it("seeds exactly 93 Annex A controls with OD's type-based P/D/C default profile", async () => {
    await seedIsraLibrary();
    expect(ISRA_ANNEXA_SEED.length).toBe(93);
    const count = await IsraAnnexAControl.count();
    expect(count).toBe(93);

    // Detective -> {fnD, dedL, dedC} (isra2DefProfile, app.html:18140)
    const detective = await IsraAnnexAControl.findByPk("A.5.7");
    expect(detective?.name).toBe("Threat intelligence");
    expect(detective).toMatchObject({ fnP: false, fnD: true, fnC: false, dedL: true, dedC: true });

    // Corrective -> {fnC, dedC}
    const corrective = await IsraAnnexAControl.findByPk("A.8.8");
    expect(corrective?.name).toBe("Management of technical vulnerabilities");
    expect(corrective).toMatchObject({ fnP: false, fnD: false, fnC: true, dedL: false, dedC: true });

    // Preventive (explicit type) -> default branch {fnP, dedL}
    const preventive = await IsraAnnexAControl.findByPk("A.8.1");
    expect(preventive?.type).toBe("Preventive");
    expect(preventive).toMatchObject({ fnP: true, fnD: false, fnC: false, dedL: true, dedC: false });

    // Directive (explicit type) -> also falls through to the default branch
    const directive = await IsraAnnexAControl.findByPk("A.5.1");
    expect(directive?.type).toBe("Directive");
    expect(directive).toMatchObject({ fnP: true, fnD: false, fnC: false, dedL: true, dedC: false });

    // OD's ISRA_ANNEXA carries no description field — ported as null, not invented.
    expect(directive?.description).toBeNull();

    const categories = new Set((await IsraAnnexAControl.findAll({ attributes: ["category"] })).map((r) => r.category));
    expect(categories).toEqual(new Set(["Organizational", "People", "Physical", "Technological"]));
  });

  it("is idempotent: re-running does not duplicate or drift any Annex A row", async () => {
    const before = await IsraAnnexAControl.findByPk("A.8.5");
    await seedIsraLibrary();
    const after = await IsraAnnexAControl.findByPk("A.8.5");
    expect(await IsraAnnexAControl.count()).toBe(93);
    expect(after?.toJSON()).toEqual(before?.toJSON());
  });

  it("seeds the Threat and Vulnerability libraries from OD's CSV datasets, deduplicated", async () => {
    const threatCount = await IsraThreatLibrary.count();
    const vulnCount = await IsraVulnLibrary.count();
    expect(threatCount).toBeGreaterThan(0);
    expect(vulnCount).toBeGreaterThan(0);

    const w70 = await IsraVulnLibrary.findByPk("VUL-0070");
    expect(w70?.name).toBe("Weak password requirements");
    const t2 = await IsraThreatLibrary.findByPk("THR-0002");
    expect(t2?.name).toBe("Account takeover");
  });

  it("seeds all 1,950 isra_km_vuln_control rows — 269 curated plus 1,681 generated", async () => {
    // OD builds this map from two sources and renders both as live edges:
    // the curated CSV (`source: "platform"`, enriched at runtime with
    // role/affects/strength) and `_israVulnCtlGenV1`'s expansion of
    // `ISRA_VULN_CTL_GEN` (`source: "vcatgen"`), which skips any vuln|annexRef
    // pair the curated map already covers.
    expect(ISRA_KM_VULN_CONTROL_SEED.length).toBe(1950);
    const bySource = ISRA_KM_VULN_CONTROL_SEED.reduce<Record<string, number>>((acc, r) => {
      const k = r.source ?? "(none)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySource).toEqual({ platform: 269, vcatgen: 1681 });

    const count = await IsraKmVulnControl.count();
    expect(count).toBe(1950);

    const distinctVulns = new Set((await IsraKmVulnControl.findAll({ attributes: ["vulnId"] })).map((r) => r.vulnId));
    expect(distinctVulns.size).toBe(392);
    const distinctAnnex = new Set((await IsraKmVulnControl.findAll({ attributes: ["annexRef"] })).map((r) => r.annexRef));
    expect(distinctAnnex.size).toBe(77);

    // VUL-0143 "Absence of API rate limiting" is curated-only: two CSV edges,
    // no generated ones, and OD's runtime enrichment applied.
    const curated = await IsraKmVulnControl.findAll({ where: { vulnId: "VUL-0143" } });
    expect(curated.map((e) => e.annexRef).sort()).toEqual(["A.8.26", "A.8.28"]);
    expect(curated.every((e) => e.status === "Published" && e.source === "platform")).toBe(true);
    expect(curated.every((e) => e.role !== null && e.affects !== null && e.strength !== null)).toBe(true);

    // VUL-0001 "Unsupported hardware" is generated-only — the first row of
    // OD's ISRA_VULN_CTL_GEN, fanned out to its eight Annex A refs.
    const generated = await IsraKmVulnControl.findAll({ where: { vulnId: "VUL-0001" } });
    expect(generated.map((e) => e.annexRef).sort()).toEqual(
      ["A.5.15", "A.5.18", "A.5.9", "A.7.13", "A.7.8", "A.8.2", "A.8.3", "A.8.8"],
    );
    expect(generated.every((e) => e.source === "vcatgen")).toBe(true);
  });

  it("seeds the Primary/Secondary asset taxonomy the knowledge maps FK into", async () => {
    const result = await seedIsraLibrary();
    expect(result.taxonomy).toEqual({
      paGroups: 5, paSubgroups: 16, saGroups: 10, saSubgroups: 39, primary: 10, secondary: 16,
    });
    expect(await IsraPaGroup.count()).toBe(5);
    expect(await IsraPaSubgroup.count()).toBe(16);
    expect(await IsraSaGroup.count()).toBe(10);
    expect(await IsraSaSubgroup.count()).toBe(39);
    expect(await IsraPrimaryAssetLibrary.count()).toBe(10);
    expect(await IsraSecondaryAssetLibrary.count()).toBe(16);

    // Spot-check the FK target every KM row in the fixtures points at.
    const ssg020 = await IsraSaSubgroup.findByPk("SSG-020");
    expect(ssg020).toMatchObject({ groupId: "SAG-007" });

    // Primary assets carry OD's CIA summary and privacy flag.
    const pal1 = await IsraPrimaryAssetLibrary.findByPk("PAL-001");
    expect(pal1).toMatchObject({ name: "Customer Personal Data", privacy: true, groupId: "PAG-001" });
  });

  it("seeds the 3-row RTP treatment-template demo catalog with resolved vuln ids", async () => {
    const count = await IsraTreatTemplate.count();
    expect(count).toBe(3);
    const tpl1 = await IsraTreatTemplate.findOne({ where: { vulnId: "VUL-0071", annexRef: "A.8.5" } });
    expect(tpl1).toMatchObject({ vulnId: "VUL-0071", annexRef: "A.8.5" });
  });

  it("ensures a single Published isra_km_meta singleton", async () => {
    const rows = await IsraKmMeta.findAll();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ version: 1, status: "Published" });
  });

  it("V2 knowledge-map derivation resolves every row now the taxonomy is seeded in the same pass", async () => {
    // Confirm the derivation shape independent of the DB: 56/194 rows derived
    // from OD's 80/272 V1 rows, matching the exact resolve() algorithm ported
    // from app.html:20889-20907 (see isra.kmSaThreat.data.ts's header for the
    // full derivation write-up and the 4 ambiguous v1 subtypes it excludes).
    expect(ISRA_KM_SA_THREAT_SEED.length).toBe(56);
    expect(ISRA_KM_THREAT_VULN_SEED.length).toBe(194);
    const kst1 = ISRA_KM_SA_THREAT_SEED.find((r) => r.id === "KST2-0001");
    expect(kst1).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002" });
    expect(kst1?.sources).toEqual(["HR System", "Public Web Application", "SaaS Business Application"]);

    // `seedAssetTaxonomy()` runs before the KM seeds, so a full run must place
    // every row. A non-zero `skipped` here is the drift alarm: it means a KM
    // fixture references a Sub-group the taxonomy fixture no longer defines.
    await IsraKmSaThreat.destroy({ where: {}, truncate: true });
    await IsraKmThreatVuln.destroy({ where: {}, truncate: true });
    const result = await seedIsraLibrary();
    expect(result.kmSaThreat).toEqual({ seeded: 56, skipped: 0 });
    expect(result.kmThreatVuln).toEqual({ seeded: 194, skipped: 0 });
    expect(await IsraKmSaThreat.count()).toBe(56);
    expect(await IsraKmThreatVuln.count()).toBe(194);

    const kst2001 = await IsraKmSaThreat.findByPk("KST2-0001");
    expect(kst2001).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002" });
    expect(kst2001?.sources).toEqual(["HR System", "Public Web Application", "SaaS Business Application"]);

    const ktv2001 = await IsraKmThreatVuln.findByPk("KTV2-0001");
    expect(ktv2001).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002", vulnId: "VUL-0070" });
  });
});
