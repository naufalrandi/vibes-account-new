import { describe, expect, it } from "vitest";
import { COUNTRY_REGION_SEED } from "./countryRegionSeed";
import { COUNTRY_SEED } from "./countrySeed";

describe("COUNTRY_REGION_SEED — OD parity", () => {
  it("carries OD's merged region table", () => {
    expect(Object.keys(COUNTRY_REGION_SEED)).toHaveLength(245);
    const regions = Object.values(COUNTRY_REGION_SEED).flat();
    expect(regions).toHaveLength(690);
    expect(regions.flatMap((r) => r.cities)).toHaveLength(1346);
  });

  it("keeps the detailed COUNTRY_REGIONS entry where both tables define a country", () => {
    // Indonesia is in OD's main table with all 38 provinces; the REST table's
    // thinner entry must not have won the merge.
    expect(COUNTRY_REGION_SEED.ID).toHaveLength(38);
    expect(COUNTRY_REGION_SEED.ID[0].name).toBe("Aceh");
    expect(COUNTRY_REGION_SEED.ID[0].cities).toContain("Kota Banda Aceh");
  });

  it("only keys countries that exist in the country seed", () => {
    const known = new Set(COUNTRY_SEED.map((c) => c.code));
    const unknown = Object.keys(COUNTRY_REGION_SEED).filter((c) => !known.has(c));
    expect(unknown).toEqual([]);
  });

  it("never contains an empty region or a region with no cities", () => {
    for (const [code, regions] of Object.entries(COUNTRY_REGION_SEED)) {
      expect(regions.length, code).toBeGreaterThan(0);
      for (const r of regions) {
        expect(r.name.trim(), code).not.toBe("");
        expect(r.cities.length, `${code}/${r.name}`).toBeGreaterThan(0);
      }
    }
  });
});
