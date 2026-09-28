/**
 * Pure, deterministic helpers for `procurement-assist.feature.ts` — no DB, no AI.
 * All figures shown to the user come from here, never from the model.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const day = (iso: string) => iso.slice(0, 10);

// ---------------------------------------------------------------- quotes

export interface QuoteRow {
  quoteId: string;
  supplierName: string;
  amount: number;
  currency: string;
  /** Value in the request's currency (the figure quotes are ranked on). */
  amountCmp: number;
  rank: number;
  deltaVsLowestPct: number;
  leadTime: string;
  quoteDate: string;
  validUntil: string;
  docType: string;
  docNumber: string;
  notes: string;
  /** Risks found in code (the model may add its own, labelled separately). */
  risks: string[];
}

/**
 * Comparison rows from the PR's stored `quotes`, cheapest first. Mirrors the frontend's
 * AwardModal ranking: the stored `amountCmp` (or `amount` when the quote is already in the
 * request's currency). A foreign-currency quote without a stored conversion can't be ranked
 * reliably and is flagged instead.
 */
export function quoteRows(pr: Record<string, unknown>, today: string): QuoteRow[] {
  const cur = str(pr.currency) || "IDR";
  const est = num(pr.estCost);
  const quotes = Array.isArray(pr.quotes) ? pr.quotes.map(obj).filter((q): q is Record<string, unknown> => !!q) : [];
  const rows = quotes.map((q) => {
    const qCur = str(q.currency) || cur;
    const amount = num(q.amount);
    const hasCmp = q.amountCmp != null && str(q.cmpCurrency || cur) === cur;
    const amountCmp = hasCmp ? num(q.amountCmp) : qCur === cur ? amount : num(q.amountIdr) || amount;
    const risks: string[] = [];
    if (qCur !== cur && !hasCmp) risks.push(`Quoted in ${qCur} with no stored conversion to ${cur}`);
    const validUntil = str(q.validUntil);
    if (validUntil && day(validUntil) < today) risks.push(`Quote validity expired on ${day(validUntil)}`);
    if (!str(q.leadTime)) risks.push("No lead time stated");
    if (!str(q.docNumber)) risks.push("No quotation document number");
    if (est > 0 && amountCmp > est * 1.1) risks.push(`${Math.round((amountCmp / est - 1) * 100)}% above the request's estimate`);
    return {
      quoteId: str(q.supplierId), supplierName: str(q.supplierName), amount, currency: qCur, amountCmp,
      rank: 0, deltaVsLowestPct: 0, leadTime: str(q.leadTime), quoteDate: str(q.quoteDate), validUntil,
      docType: str(q.docType), docNumber: str(q.docNumber), notes: str(q.notes), risks,
    };
  });
  rows.sort((a, b) => a.amountCmp - b.amountCmp);
  const lowest = rows[0]?.amountCmp ?? 0;
  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    deltaVsLowestPct: lowest > 0 ? Math.round(((r.amountCmp - lowest) / lowest) * 1000) / 10 : 0,
  }));
}

// ---------------------------------------------------------------- 3-way match

export type Severity = "high" | "medium" | "low";

export interface Discrepancy {
  code: string;
  severity: Severity;
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface MatchLegs {
  currency: string;
  qty: number;
  po: { id: string | null; code: string | null; amount: number; unitPrice: number; supplierName: string; issuedDate: string; deliveryBy: string; currency: string; voided: boolean } | null;
  receipt: { id: string; date: string; value: number; unitPrice: number; condition: string } | null;
  invoice: { number: string; date: string; amount: number; unitPrice: number; supplierName: string } | null;
  tolerance: number;
}

export interface PoInput {
  id: string;
  code: string;
  data: Record<string, unknown>;
}

/** OD `prMatch` tolerance: ±1% of the PO amount, never below 1 currency unit. */
export const tolerance = (poAmount: number) => Math.max(1, poAmount * 0.01);

/** PR estimate in the settlement currency (`estCost`, else unitValue × qty × duration × exRate). */
function prEstimate(pr: Record<string, unknown>): number {
  if (num(pr.estCost) > 0) return num(pr.estCost);
  return num(pr.unitValue) * (num(pr.qty) || 1) * (num(pr.duration) || 1) * (num(pr.exRate) || 1);
}

/**
 * PO vs receipt vs invoice, in code. The PO leg is the issued PO's amount when there is one,
 * else the PR estimate (the frontend's `prPoAmount`). Unit prices are the leg totals divided by
 * the requested quantity × duration (receipts and invoices carry no quantity of their own; a
 * quantity shortfall shows up in the QC checklist, which is checked too).
 */
export function threeWayCheck(pr: Record<string, unknown>, po: PoInput | null): { legs: MatchLegs; discrepancies: Discrepancy[] } {
  const cur = str(pr.currency) || "IDR";
  const units = (num(pr.qty) || 1) * (num(pr.duration) || 1);
  const unitOf = (n: number) => Math.round((n / units) * 100) / 100;
  const poAmount = po ? num(po.data.amount) : prEstimate(pr);
  const tol = tolerance(poAmount);
  const rec = obj(pr.receipt);
  const inv = obj(pr.invoice);
  const qc = obj(pr.qc);

  const legs: MatchLegs = {
    currency: cur,
    qty: units,
    po: po
      ? {
          id: po.id, code: po.code, amount: poAmount, unitPrice: unitOf(poAmount), supplierName: str(po.data.supplierName),
          issuedDate: str(po.data.issuedDate), deliveryBy: str(po.data.deliveryBy), currency: str(po.data.currency) || cur, voided: po.data.voided === true,
        }
      : null,
    receipt: rec ? { id: str(rec.id), date: str(rec.date), value: num(rec.value), unitPrice: unitOf(num(rec.value)), condition: str(rec.condition) } : null,
    invoice: inv ? { number: str(inv.number) || str(inv.id), date: str(inv.date), amount: num(inv.amount), unitPrice: unitOf(num(inv.amount)), supplierName: str(inv.supplierName) } : null,
    tolerance: tol,
  };

  const out: Discrepancy[] = [];
  const add = (d: Discrepancy) => out.push(d);
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;

  if (!po) add({ code: "po_missing", severity: "medium", message: "No purchase order is linked; the request estimate stands in for the PO amount.", expected: "Issued PO", actual: money(poAmount) });
  if (!rec) add({ code: "receipt_missing", severity: "medium", message: "No goods/service receipt is recorded." });
  if (!inv) add({ code: "invoice_missing", severity: "medium", message: "No supplier invoice is recorded." });
  if (legs.po?.voided) add({ code: "po_voided", severity: "high", message: `Purchase order ${po!.code} is voided.` });
  if (legs.po && legs.po.currency !== cur) add({ code: "currency_mismatch", severity: "high", message: "The PO currency differs from the request currency.", expected: cur, actual: legs.po.currency });

  const cmp = (code: string, label: string, a: number, b: number) => {
    if (Math.abs(a - b) > tol) {
      add({
        code, severity: "high",
        message: `${label}: ${money(b)} vs ${money(a)} (difference ${money(b - a)}; tolerance ±${money(tol)}; unit price ${money(unitOf(b))} vs ${money(unitOf(a))}).`,
        expected: a, actual: b,
      });
    }
  };
  if (legs.receipt) cmp("receipt_vs_po_amount", "Receipt value vs PO amount", poAmount, legs.receipt.value);
  if (legs.invoice) cmp("invoice_vs_po_amount", "Invoice amount vs PO amount", poAmount, legs.invoice.amount);
  if (legs.receipt && legs.invoice) cmp("invoice_vs_receipt_amount", "Invoice amount vs receipt value", legs.receipt.value, legs.invoice.amount);

  const qtyAnswer = obj(obj(qc?.answers)?.qty);
  if (qtyAnswer && str(qtyAnswer.tone) !== "ok") {
    add({ code: "qty_mismatch", severity: "high", message: `QC recorded a quantity issue: ${str(qtyAnswer.label)}.`, expected: units, actual: str(qtyAnswer.label) });
  }
  if (qc && str(qc.tone) === "bad") add({ code: "qc_rejected", severity: "high", message: `QC decision: ${str(qc.decision)}.` });

  if (legs.po && legs.invoice?.supplierName && legs.po.supplierName
    && legs.invoice.supplierName.trim().toLowerCase() !== legs.po.supplierName.trim().toLowerCase()) {
    add({ code: "supplier_mismatch", severity: "high", message: "The invoice supplier differs from the PO supplier.", expected: legs.po.supplierName, actual: legs.invoice.supplierName });
  }

  const issued = legs.po?.issuedDate ? day(legs.po.issuedDate) : "";
  const recDate = legs.receipt?.date ? day(legs.receipt.date) : "";
  const invDate = legs.invoice?.date ? day(legs.invoice.date) : "";
  const dueBy = legs.po?.deliveryBy ? day(legs.po.deliveryBy) : "";
  if (issued && recDate && recDate < issued) add({ code: "receipt_before_po", severity: "medium", message: "Receipt is dated before the PO was issued.", expected: `≥ ${issued}`, actual: recDate });
  if (issued && invDate && invDate < issued) add({ code: "invoice_before_po", severity: "medium", message: "Invoice is dated before the PO was issued.", expected: `≥ ${issued}`, actual: invDate });
  if (recDate && invDate && invDate < recDate) add({ code: "invoice_before_receipt", severity: "low", message: "Invoice is dated before the receipt.", expected: `≥ ${recDate}`, actual: invDate });
  if (dueBy && recDate && recDate > dueBy) add({ code: "late_delivery", severity: "low", message: "Delivery was received after the PO's delivery date.", expected: `≤ ${dueBy}`, actual: recDate });

  return { legs, discrepancies: out };
}
