import { describe, expect, it } from "vitest";
import { POL_FREQ_MO, POL_FW_CODE, derivePolicyData, polNextReview, polNextVersion } from "./policyControl";

describe("policyControl (OD pol* derivations)", () => {
  it("maps the seven OD POL_FW_CODE frameworks (10104)", () => {
    expect(POL_FW_CODE["ISO 9001:2015"]).toBe("QMS");
    expect(POL_FW_CODE["ISO/IEC 27001:2022"]).toBe("ISMS");
    expect(POL_FW_CODE["ISO 22301:2019"]).toBe("BCMS");
    expect(POL_FW_CODE["ISO 37001:2025"]).toBe("ABMS");
    expect(Object.keys(POL_FW_CODE)).toHaveLength(7);
  });

  it("polNextReview adds the POL_FREQ_MO months to the effective date", () => {
    const next = polNextReview("2026-01-15T00:00:00.000Z", "Quarterly");
    expect(next.slice(0, 10)).toBe("2026-04-15");
    expect(polNextReview("2026-01-15T00:00:00.000Z", "Every 2 years").slice(0, 4)).toBe("2028");
    // Unknown/blank frequency falls back to 12 months, matching OD `||12`.
    expect(polNextReview("2026-01-15T00:00:00.000Z", "").slice(0, 10)).toBe("2027-01-15");
    expect(POL_FREQ_MO.Custom).toBe(12);
  });

  it("polNextReview returns '' without a valid effective date", () => {
    expect(polNextReview("", "Annually")).toBe("");
    expect(polNextReview(undefined, "Annually")).toBe("");
    expect(polNextReview("not-a-date", "Annually")).toBe("");
  });

  it("polNextVersion bumps integers ('1' → '2') and defaults blanks to '1'", () => {
    expect(polNextVersion("1")).toBe("2");
    expect(polNextVersion("3")).toBe("4");
    expect(polNextVersion("")).toBe("1");
    expect(polNextVersion(undefined)).toBe("1");
  });

  it("derivePolicyData recomputes nextReview and never mutates the input", () => {
    const input = { effectiveDate: "2026-01-15T00:00:00.000Z", reviewFreq: "Semi-annually", nextReview: "hand-set" };
    const out = derivePolicyData(input);
    expect((out.nextReview as string).slice(0, 10)).toBe("2026-07-15");
    expect(input.nextReview).toBe("hand-set");
  });
});
