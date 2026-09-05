import { describe, expect, it } from "vitest";
import { assertValidProposalData, OD_DEFAULT_TAX_PCT } from "./proposalRules";

/**
 * OD opens every proposal at 11% tax — `proposalStart` (js/modules.js:2502) and
 * `certProposalStart` (:2221) both hard-code `taxPct:11`. This validator defaulted to 0,
 * so any proposal created without an explicit rate was quoted tax-free.
 */
describe("assertValidProposalData — OD defaults", () => {
  const items = [{ description: "Consulting", qty: 2, unitPrice: 1_000_000 }];

  it("opens a new proposal at OD's 11% tax when none is supplied", () => {
    const out = assertValidProposalData({ currency: "IDR", items }, { isCreate: true });
    expect(out.taxPct).toBe(OD_DEFAULT_TAX_PCT);
    // 2,000,000 subtotal, no discount, 11% tax.
    expect(out.totals).toMatchObject({ sub: 2_000_000, tax: 220_000, total: 2_220_000 });
  });

  it("respects an explicit 0% — the default only fills an absent rate", () => {
    const out = assertValidProposalData({ currency: "IDR", items, taxPct: 0 }, { isCreate: true });
    expect(out.taxPct).toBe(0);
    expect(out.totals).toMatchObject({ tax: 0, total: 2_000_000 });
  });

  it("does not re-tax an existing proposal on update", () => {
    // Records saved under the old 0% default must not gain 11% just by being saved again.
    const out = assertValidProposalData({ currency: "IDR", items });
    expect(out.taxPct).toBe(0);
  });

  it("fixes a certification proposal to IDR and the audit contract type on create", () => {
    const out = assertValidProposalData(
      { cert: { standards: ["ISO 9001:2015"], personnel: 40 } },
      { isCreate: true },
    );
    expect(out.currency).toBe("IDR");
    expect(out.contractTypeId).toBe("ct-svc-audit");
    expect(out.taxPct).toBe(OD_DEFAULT_TAX_PCT);
    // Auto-priced from the man-day engine: three items (IA, SA1, SA2).
    expect(out.items).toHaveLength(3);
  });
});
