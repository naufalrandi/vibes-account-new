import { describe, expect, it } from "vitest";
import { quoteRows, threeWayCheck, tolerance } from "./procurement-assist.context";
import { keepKnown, pickSqAnswers, recordForPrompt, sqKeysFor } from "./sales-assist.context";

const PR = {
  currency: "IDR", qty: 2, duration: 1, estCost: 1_000_000,
  quotes: [
    { supplierId: "s-b", supplierName: "Beta", amount: 1_200_000, currency: "IDR", leadTime: "2 weeks", docNumber: "Q-2", validUntil: "2026-01-01" },
    { supplierId: "s-a", supplierName: "Alpha", amount: 950_000, currency: "IDR", leadTime: "", docNumber: "Q-1" },
    { supplierId: "s-c", supplierName: "Gamma", amount: 60, currency: "USD" },
  ],
};

describe("procurement-assist quoteRows", () => {
  it("ranks by comparable amount and flags risks in code", () => {
    const rows = quoteRows({ ...PR, quotes: PR.quotes.slice(0, 2) }, "2026-09-27");
    expect(rows.map((r) => r.quoteId)).toEqual(["s-a", "s-b"]);
    expect(rows[0]).toMatchObject({ rank: 1, deltaVsLowestPct: 0 });
    expect(rows[1].deltaVsLowestPct).toBeCloseTo(26.3, 1);
    expect(rows[0].risks).toContain("No lead time stated");
    expect(rows[1].risks.join(" ")).toMatch(/validity expired on 2026-01-01/);
    expect(rows[1].risks.join(" ")).toMatch(/20% above the request's estimate/);
  });

  it("flags a foreign-currency quote with no stored conversion and uses amountCmp when present", () => {
    const rows = quoteRows(PR, "2026-01-01");
    expect(rows.find((r) => r.quoteId === "s-c")!.risks[0]).toMatch(/Quoted in USD with no stored conversion/);
    const withCmp = quoteRows({ ...PR, quotes: [{ ...PR.quotes[2], amountCmp: 900_000, cmpCurrency: "IDR" }] }, "2026-01-01");
    expect(withCmp[0].amountCmp).toBe(900_000);
  });
});

describe("procurement-assist threeWayCheck", () => {
  const po = { id: "po1", code: "PO-1", data: { amount: 1_000_000, supplierName: "Alpha", issuedDate: "2026-07-10T09:00:00", deliveryBy: "2026-07-20", currency: "IDR" } };

  it("reports no discrepancies when PO, receipt and invoice agree within ±1%", () => {
    const pr = { ...PR, receipt: { id: "GRN-1", date: "2026-07-15", value: "1005000" }, invoice: { number: "INV-1", amount: 995_000, date: "2026-07-16", supplierName: "alpha" } };
    const r = threeWayCheck(pr, po);
    expect(r.discrepancies).toEqual([]);
    expect(r.legs.tolerance).toBe(10_000);
    expect(r.legs.po!.unitPrice).toBe(500_000);
  });

  it("finds amount, supplier, quantity and date discrepancies", () => {
    const pr = {
      ...PR,
      receipt: { id: "GRN-1", date: "2026-07-25", value: "1000000" },
      invoice: { number: "INV-1", amount: 1_100_000, date: "2026-07-05", supplierName: "Other Co" },
      qc: { tone: "warn", decision: "accept", answers: { qty: { label: "Shortage", tone: "warn" } } },
    };
    const codes = threeWayCheck(pr, po).discrepancies.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining([
      "invoice_vs_po_amount", "invoice_vs_receipt_amount", "qty_mismatch", "supplier_mismatch",
      "invoice_before_po", "invoice_before_receipt", "late_delivery",
    ]));
    expect(codes).not.toContain("receipt_vs_po_amount");
  });

  it("falls back to the PR estimate and reports missing documents", () => {
    const r = threeWayCheck(PR, null);
    expect(r.legs.po).toBeNull();
    expect(r.discrepancies.map((d) => d.code)).toEqual(["po_missing", "receipt_missing", "invoice_missing"]);
    expect(tolerance(50)).toBe(1);
  });
});

describe("sales-assist context", () => {
  it("resolves questionnaire keys per service and variant", () => {
    expect(sqKeysFor("impl", "Full Consultancy")).toEqual(["timeline", "frameworks", "sites", "maturity", "targetCert", "headcount"]);
    expect(sqKeysFor("comp", "In-house training")).not.toContain("timeline");
    expect(sqKeysFor("nope", undefined)).toEqual(["timeline"]);
  });

  it("keeps only allowed, non-empty sq answers and known ids", () => {
    expect(pickSqAnswers([{ key: "sites", value: " 3 " }, { key: "evil", value: "x" }, { key: "headcount", value: "" }], ["sites", "headcount"])).toEqual({ sites: "3" });
    expect(keepKnown([{ id: "a" }, { id: "zz" }, { id: "a" }], (x) => x.id, new Set(["a"]))).toEqual([{ id: "a" }]);
  });

  it("redacts PII and drops the activity trail from prompt records", () => {
    const out = recordForPrompt({
      id: "1", area: "enterprise", module: "ent-leads", code: "LD-1", title: "Lead", status: "New", owner: null, company: "axia",
      data: { email: "budi@example.com", activity: [{ action: "x" }] }, createdAt: new Date(0), updatedAt: new Date(0),
    });
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("budi@example.com");
    expect(out).not.toContain("activity");
  });
});
