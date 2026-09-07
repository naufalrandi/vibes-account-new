import { describe, expect, it } from "vitest";
import { assertValidProposalData, OD_DEFAULT_TAX_PCT } from "./proposalRules";

/**
 * OD opens every proposal at 11% tax — `proposalStart` (js/modules.js:2502) and
 * `certProposalStart` (:2221) both hard-code `taxPct:11`. This validator defaulted to 0,
 * so any proposal created without an explicit rate was quoted tax-free.
 */
describe("assertValidProposalData — OD defaults", () => {
  const items = [{ desc: "Consulting", qty: 2, unit: 1_000_000 }];

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
    expect((out.items as Record<string, unknown>[])[0]).toEqual({
      desc: "Initial certification audit (Stage 1 + Stage 2)", qty: expect.any(Number), unit: expect.any(Number),
    });
  });

  /**
   * R98/R99 — OD `certProposalStart` (js/modules.js:2221) prices the three lines off the
   * Application Review's own `a.mdIA`/`a.mdSA`/`a.mdTotal`, and `ssMoney` (js/modules.js:4747)
   * is `toLocaleString('en-US')`, so the note groups with commas, not id-ID's dots.
   */
  it("prices a certification proposal from the AR's man-days and quotes OD's en-US note", () => {
    const out = assertValidProposalData(
      { cert: { standards: ["ISO 9001:2015"], personnel: 40, mdIA: 6, mdSA: 2, mdTotal: 10, ratePerMd: 8_000_000 } },
      { isCreate: true },
    );
    expect(out.items).toEqual([
      { desc: "Initial certification audit (Stage 1 + Stage 2)", qty: 6, unit: 8_000_000 },
      { desc: "Surveillance audit 1", qty: 2, unit: 8_000_000 },
      { desc: "Surveillance audit 2", qty: 2, unit: 8_000_000 },
    ]);
    expect(out.notes).toBe("Audit time: IA 6 + SA 2\u00d72 = 10 md @ IDR 8,000,000/md (MD5/27006-1).");
  });
});

/**
 * OD `propFormSave` (js/modules.js:2488) stores `{id, courseId, courseCode, desc,
 * qty, unit}`, which is what all nine seeded proposals carry. Normalising to
 * `{description, qty, unitPrice}` rejected them on edit and destroyed the id and
 * the linked course code on save.
 */
describe("assertValidProposalData — OD line-item shape", () => {
  it("keeps a seeded line item's id, course code and OD keys", () => {
    const out = assertValidProposalData({
      currency: "IDR", taxPct: 11, discount: 5_000_000,
      items: [
        { id: "pi-1", courseId: "crs-1", courseCode: "7300", desc: "ISO 27001 Lead Implementer — certification (PECB)", qty: 6, unit: 9_500_000 },
        { id: "pi-2", desc: "Exam & certification fees", qty: 6, unit: 3_500_000 },
      ],
    });
    expect(out.items).toEqual([
      { desc: "ISO 27001 Lead Implementer — certification (PECB)", qty: 6, unit: 9_500_000, id: "pi-1", courseId: "crs-1", courseCode: "7300" },
      { desc: "Exam & certification fees", qty: 6, unit: 3_500_000, id: "pi-2" },
    ]);
    // (6x9,500,000 + 6x3,500,000 - 5,000,000) x 1.11
    expect(out.totals).toMatchObject({ sub: 78_000_000, disc: 5_000_000, total: 81_030_000 });
  });

  it("still accepts the pre-rename description/unitPrice spellings", () => {
    const out = assertValidProposalData({ currency: "IDR", items: [{ description: "Consulting", qty: 1, unitPrice: 100 }] });
    expect(out.items).toEqual([{ desc: "Consulting", qty: 1, unit: 100 }]);
  });
});
