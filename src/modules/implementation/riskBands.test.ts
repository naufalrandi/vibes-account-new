import { describe, expect, it } from "vitest";
import { enrichData, riskBandsFor, RISK_BANDS_DEFAULT } from "./registry";

/**
 * R176 — the implementation registry banded every risk against the fixed default
 * scheme, while the risks module bands against the tenant's own `riskLevels`
 * (`risk.service.ts` `computeRiskBand`). A tenant that had renamed or re-bounded its
 * levels therefore saw two different vocabularies for the same number.
 */
describe("riskBandsFor", () => {
  it("falls back to the default scheme when the org has none", () => {
    expect(riskBandsFor(null)).toBe(RISK_BANDS_DEFAULT);
    expect(riskBandsFor({ names: [], bounds: [] })).toBe(RISK_BANDS_DEFAULT);
  });

  it("maps the org's names and bounds, leaving the top band unbounded", () => {
    const scheme = riskBandsFor({ names: ["Minor", "Moderate", "Severe"], bounds: [6, 12] });
    expect(scheme).toEqual([
      { max: 6, level: "Minor" },
      { max: 12, level: "Moderate" },
      { max: Number.POSITIVE_INFINITY, level: "Severe" },
    ]);
  });
});

describe("enrichData risk banding", () => {
  it("bands against the tenant's scheme when one is passed", () => {
    const scheme = riskBandsFor({ names: ["Minor", "Moderate", "Severe"], bounds: [6, 12] });
    // 4 × 3 = 12 — "High" under the default four-band scheme, "Moderate" under this one.
    expect(enrichData("risks", { likelihood: 4, impact: 3 }, scheme)).toMatchObject({ riskScore: 12, riskLevel: "Moderate", band: "Moderate" });
    expect(enrichData("risks", { likelihood: 4, impact: 3 })).toMatchObject({ riskScore: 12, riskLevel: "High" });
  });

  it("puts a score above the last bound in the top band", () => {
    const scheme = riskBandsFor({ names: ["Minor", "Moderate", "Severe"], bounds: [6, 12] });
    expect(enrichData("risks", { likelihood: 5, impact: 5 }, scheme)).toMatchObject({ riskLevel: "Severe" });
  });
});
