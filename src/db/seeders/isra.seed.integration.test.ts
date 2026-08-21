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
  IsraSaGroup,
  IsraSaSubgroup,
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
 *  - the 269-row `isra_km_vuln_control` CSV seed;
 *  - the re-derived V2 knowledge maps (`isra_km_sa_threat`/
 *    `isra_km_threat_vuln`) — this seeder intentionally SKIPS any KM row
 *    whose Sub-group id isn't in `isra_sa_subgroups` yet (F-2a's taxonomy
 *    seed, which may not have landed when this runs), so this test proves
 *    both halves of that behavior: graceful skip when the taxonomy is
 *    absent, and correct insertion once a taxonomy row exists.
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

  it("seeds exactly 269 isra_km_vuln_control rows verbatim from isra-vuln-control-map.csv", async () => {
    expect(ISRA_KM_VULN_CONTROL_SEED.length).toBe(269);
    const count = await IsraKmVulnControl.count();
    expect(count).toBe(269);

    const distinctVulns = new Set((await IsraKmVulnControl.findAll({ attributes: ["vulnId"] })).map((r) => r.vulnId));
    expect(distinctVulns.size).toBe(126);
    const distinctAnnex = new Set((await IsraKmVulnControl.findAll({ attributes: ["annexRef"] })).map((r) => r.annexRef));
    expect(distinctAnnex.size).toBe(40);

    // VUL-0143 "Absence of API rate limiting" maps to two controls in the CSV.
    const edges = await IsraKmVulnControl.findAll({ where: { vulnId: "VUL-0143" } });
    expect(edges.map((e) => e.annexRef).sort()).toEqual(["A.8.26", "A.8.28"]);
    expect(edges.every((e) => e.status === "Published" && e.source === "isra-vuln-control-map.csv")).toBe(true);
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

  it("V2 knowledge-map derivation: skips rows whose Sub-group has no isra_sa_subgroups row yet, and inserts correctly once one exists", async () => {
    // Confirm the derivation shape independent of the DB: 56/194 rows derived
    // from OD's 80/272 V1 rows, matching the exact resolve() algorithm ported
    // from app.html:20889-20907 (see isra.kmSaThreat.data.ts's header for the
    // full derivation write-up and the 4 ambiguous v1 subtypes it excludes).
    expect(ISRA_KM_SA_THREAT_SEED.length).toBe(56);
    expect(ISRA_KM_THREAT_VULN_SEED.length).toBe(194);
    const kst1 = ISRA_KM_SA_THREAT_SEED.find((r) => r.id === "KST2-0001");
    expect(kst1).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002" });
    expect(kst1?.sources).toEqual(["HR System", "Public Web Application", "SaaS Business Application"]);

    // Before any isra_sa_subgroups row exists for SSG-020, the seeder must
    // skip rather than fail on the FK.
    await IsraKmSaThreat.destroy({ where: { subgroupId: "SSG-020" } });
    await IsraKmThreatVuln.destroy({ where: { subgroupId: "SSG-020" } });
    const beforeTaxonomy = await seedIsraLibrary();
    expect(beforeTaxonomy.kmSaThreat.seeded).toBe(0);
    expect(beforeTaxonomy.kmSaThreat.skipped).toBe(56);
    expect(await IsraKmSaThreat.count()).toBe(0);
    expect(await IsraKmThreatVuln.count()).toBe(0);

    // Insert only the two taxonomy rows the KST2-0001/KTV2-0001 rows need
    // (F-2a's own seed data, minimally reproduced here so this test is
    // self-contained rather than depending on F-2a's seeder having run).
    await IsraSaGroup.findOrCreate({ where: { id: "SAG-007" }, defaults: { id: "SAG-007", name: "Applications and Software" } });
    await IsraSaSubgroup.findOrCreate({
      where: { id: "SSG-020" },
      defaults: { id: "SSG-020", groupId: "SAG-007", name: "Web and Mobile Applications", description: null, examples: [], status: "Approved", version: 1 },
    });

    const afterTaxonomy = await seedIsraLibrary();
    // Only the 17 KST2 / 62 KTV2 rows keyed to SSG-020 now resolve; the other
    // 5 Sub-groups (SSG-011/021/023/025/026) still have no taxonomy row, so
    // their rows stay skipped — proving the skip is per-row, not all-or-nothing.
    expect(afterTaxonomy.kmSaThreat.seeded).toBe(17);
    expect(afterTaxonomy.kmSaThreat.skipped).toBe(56 - 17);
    expect(afterTaxonomy.kmThreatVuln.seeded).toBe(62);
    expect(afterTaxonomy.kmThreatVuln.skipped).toBe(194 - 62);

    const kst2001 = await IsraKmSaThreat.findByPk("KST2-0001");
    expect(kst2001).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002" });
    expect(kst2001?.sources).toEqual(["HR System", "Public Web Application", "SaaS Business Application"]);

    const ktv2001 = await IsraKmThreatVuln.findByPk("KTV2-0001");
    expect(ktv2001).toMatchObject({ subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002", vulnId: "VUL-0070" });
  });
});
