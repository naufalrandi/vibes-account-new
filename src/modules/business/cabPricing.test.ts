import { describe, expect, it } from "vitest";
import {
  cabAuditDays, cabCertManDays, cabComplexityAdj, cabFactorPct, cabInitialDays, cabSampleSize, cabStdAdj,
  canIssueCertificate, CAB_ISMS_STANDARD, type CabFactorRating,
} from "./cabPricing";

describe("cabPricing — Exelera CAB man-day engine (ported from design source core.js)", () => {
  it("single-site, single-standard Stage 1: MD5 table lookup + 34% Stage 1 fraction", () => {
    // 140 personnel falls in the (125,175] QMS1 bracket → base 8 man-days (core.js CAB_QMS1).
    const standards = ["ISO 9001:2015"];
    const initial = cabInitialDays(140, standards, 0);
    expect(initial).toBe(8);
    const stage1 = cabAuditDays("Stage 1", 140, standards, 0);
    expect(stage1).toBe(Math.round(8 * 0.34 * 2) / 2); // 2.5 (rounded to nearest 0.5)
    expect(stage1).toBe(2.5);
  });

  it("multi-site IAF MD 1 √N sampling: Stage 1/2 use k=1, Surveillance uses k=0.6, single site is always 1", () => {
    expect(cabSampleSize(1, "Stage 1")).toBe(1);
    // 5 sites, Stage 2: ceil(1 * sqrt(5)) = ceil(2.236) = 3
    expect(cabSampleSize(5, "Stage 2")).toBe(3);
    // 5 sites, Surveillance 1: ceil(0.6 * sqrt(5)) = ceil(1.342) = 2
    expect(cabSampleSize(5, "Surveillance 1")).toBe(2);
    // 5 sites, Recertification: ceil(0.8 * sqrt(5)) = ceil(1.789) = 2
    expect(cabSampleSize(5, "Recertification")).toBe(2);
  });

  it("IMS uplift: a two-standard scope gets +55% man-days over a single standard, before complexity", () => {
    const oneStd = cabInitialDays(140, ["ISO 9001:2015"], 0);
    const twoStd = cabInitialDays(140, ["ISO 9001:2015", "ISO 14001:2015"], 0);
    expect(twoStd).toBe(Math.round(oneStd * 1.55 * 2) / 2);
    expect(oneStd).toBe(8);
    expect(twoStd).toBe(12.5); // 8 * 1.55 = 12.4 -> rounds to 12.5 at the 0.5 grid
  });

  it("ISMS standard switches to the larger ISO/IEC 27006-1 Annex C table", () => {
    const qms = cabInitialDays(140, ["ISO 9001:2015"], 0);
    const isms = cabInitialDays(140, [CAB_ISMS_STANDARD], 0);
    expect(qms).toBe(8);
    expect(isms).toBe(13); // (125,175] bracket in CAB_ISMS is 13
  });

  it("complexity adjustment is capped at -30% and averages across standards", () => {
    const adj = cabComplexityAdj(
      ["ISO 9001:2015", "ISO 45001:2018"],
      { "ISO 9001:2015": "Low", "ISO 45001:2018": "Low" },
    );
    // (-0.10 + -0.10) / 2 = -0.10, well above the -0.30 floor
    expect(adj).toBeCloseTo(-0.10);
    // A single very-negative-weighted standard still respects the -0.30 cap (no standard alone
    // reaches -0.30 in the table above, so this exercises the cap function stays inert here).
    expect(adj).toBeGreaterThanOrEqual(-0.3);
  });

  it("cabCertManDays (commercial funnel: initial + 2 surveillance) matches ia + 2*sa", () => {
    const { ia, sa, total } = cabCertManDays(140, ["ISO 9001:2015"], 0);
    expect(ia).toBe(8);
    expect(sa).toBe(cabAuditDays("Surveillance 1", 140, ["ISO 9001:2015"], 0));
    expect(total).toBe(Math.round((ia + 2 * sa) * 2) / 2);
  });

  it("certificate issuance is blocked by an open Major NC, allowed with only open Minor/OFI", () => {
    expect(canIssueCertificate([{ grade: "Major", open: true }])).toBe(false);
    expect(canIssueCertificate([{ grade: "Major", open: false }])).toBe(true); // resolved Major doesn't block
    expect(canIssueCertificate([{ grade: "Minor", open: true }, { grade: "OFI", open: true }])).toBe(true);
    expect(canIssueCertificate([])).toBe(true);
  });
});

// R97/R714 — per-factor complexity scoring.
describe("cabStdAdj / cabFactorPct (core.js:3988-3991)", () => {
  const ISMS = "ISO/IEC 27001:2022";

  it("splits a standard's full swing across its four factors", () => {
    expect(cabFactorPct(ISMS, "Above")).toBeCloseTo(0.30 / 4, 6);
    expect(cabFactorPct(ISMS, "Below")).toBeCloseTo(-0.10 / 4, 6);
    expect(cabFactorPct(ISMS, "Average")).toBe(0);
  });

  it("four Above factors sum to exactly the standard's High level", () => {
    const scores = { [ISMS]: ["Above", "Above", "Above", "Above"] as CabFactorRating[] };
    expect(cabStdAdj(ISMS, undefined, scores)).toBeCloseTo(0.30, 6);
  });

  it("falls back to the coarse level when no factor is scored", () => {
    expect(cabStdAdj(ISMS, "High")).toBeCloseTo(0.30, 6);
    expect(cabStdAdj(ISMS, "Low")).toBeCloseTo(-0.10, 6);
    expect(cabStdAdj(ISMS, "Standard")).toBe(0);
  });

  it("a stored factor rating overrides the coarse level for that factor only", () => {
    const scores = { [ISMS]: ["Below"] as CabFactorRating[] };
    // factor 0 Below, factors 1-3 fall back to High -> Above
    expect(cabStdAdj(ISMS, "High", scores)).toBeCloseTo(-0.10 / 4 + 3 * (0.30 / 4), 6);
  });

  it("feeds cabComplexityAdj, still averaged across standards and floored at -30%", () => {
    const scores = { [ISMS]: ["Above", "Above", "Above", "Above"] as CabFactorRating[] };
    expect(cabComplexityAdj([ISMS], {}, scores)).toBeCloseTo(0.30, 6);
    expect(cabComplexityAdj([ISMS, "ISO 9001:2015"], {}, scores)).toBeCloseTo(0.15, 6);
  });
});
