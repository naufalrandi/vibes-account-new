/**
 * AXI-43 server-side guards for the Proposals module (`enterprise/ent-proposals`), wired into
 * `createBusiness`/`updateBusiness` the same conditional-by-module way `assertValidInquiryData`
 * is scoped to `ent-inq` (business.service.ts).
 *
 * Validates `data.currency`/`data.items`/`data.discount`/`data.taxPct` and, critically,
 * SERVER-COMPUTES `data.totals` from those fields on every create/update — mirroring OD's
 * `propCalc` (modules.js ~L2447) exactly — so a client can never spoof `totals.total` by sending
 * a pre-computed value. Any client-supplied `data.totals` is discarded and overwritten.
 *
 * `contractTypeId`/`clauseIds` are validated loosely (non-empty strings if present) only — this
 * module intentionally does NOT cross-reference the `ent-svc-ctypes`/`ent-svc-clauses` tables to
 * confirm the ids exist, an unnecessary coupling for this issue (runtime brief's own call).
 */
import { BadRequestError } from "../../lib/errors";
import { cabCertManDays, cabComplexityAdj, CAB_RATE_DEFAULT, type CabComplexityLevel } from "./cabPricing";

export interface ProposalItem {
  description: string;
  qty: number;
  unitPrice: number;
  courseId?: string;
  courseLink?: string;
}

/** OD `propCalc` (js/modules.js:2452) names the discount key `disc` and returns the
 *  RAW entered amount, not the clamped applied one. fe-vibes-new was aligned to that
 *  in the sales pass; this is the backend half so the persisted `data.totals` object
 *  round-trips with the same key on both sides. */
export interface ProposalTotals {
  sub: number;
  disc: number;
  tax: number;
  total: number;
}

/** Mirrors OD's `propCalc` (modules.js ~L2447) verbatim: sub = Σ qty*unitPrice, afterDisc floors
 *  at 0, tax = afterDisc * taxPct/100, total = afterDisc + tax. */
export function computeProposalTotals(items: ProposalItem[], discount: number, taxPct: number): ProposalTotals {
  const sub = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const disc = Number(discount) || 0;
  const afterDisc = Math.max(0, sub - disc);
  const tax = afterDisc * ((Number(taxPct) || 0) / 100);
  return { sub, disc, tax, total: afterDisc + tax };
}

function assertValidItems(itemsRaw: unknown): ProposalItem[] {
  if (!Array.isArray(itemsRaw)) throw new BadRequestError("Proposal items must be an array", "INVALID_ITEMS");
  return itemsRaw.map((raw, idx) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const description = String(item.description ?? "").trim();
    if (!description) throw new BadRequestError(`Item ${idx + 1}: description is required`, "INVALID_ITEM");
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestError(`Item ${idx + 1}: qty must be greater than 0`, "INVALID_ITEM");
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new BadRequestError(`Item ${idx + 1}: unitPrice must be >= 0`, "INVALID_ITEM");
    const out: ProposalItem = { description, qty, unitPrice };
    if (item.courseId !== undefined && item.courseId !== "") out.courseId = String(item.courseId);
    if (item.courseLink !== undefined && item.courseLink !== "") out.courseLink = String(item.courseLink);
    return out;
  });
}

/** OD `cabInqReview` (js/modules.js:2213) — the commercial funnel's one overall rating. */
export type CabOverallComplexity = "Low" | "Standard" | "High";

/**
 * R92 — the PROPOSAL path adjusts man-days off a single overall rating, not
 * the per-standard `CAB_COMPLEXITY_LEVELS` table the Application Review uses:
 * `var adj={Low:-0.1,Standard:0,High:0.2}[q.ar.cx]||0;`.
 */
export const CAB_PROPOSAL_COMPLEXITY_ADJ: Record<CabOverallComplexity, number> = {
  Low: -0.1,
  Standard: 0,
  High: 0.2,
};

export interface ProposalCertInput {
  standards: string[];
  personnel: number;
  sites?: number;
  /**
   * OD `q.ar.cx` — one overall rating for the whole scope. A per-standard map
   * is still accepted (an Application Review writes one) and folded through
   * `cabComplexityAdj` so an older record keeps pricing.
   */
  complexity?: CabOverallComplexity | Record<string, CabComplexityLevel>;
  ratePerMd?: number;
}

/**
 * Certification-inquiry auto-pricing hook (runtime brief's "when a proposal is for a
 * certification-inquiry, the same man-day math should auto-price the proposal"). Mirrors OD's
 * `certProposalStart` (modules.js:2215-2216): three line items — Initial certification audit
 * (Stage 1 + Stage 2), Surveillance audit 1, Surveillance audit 2 — quantity = man-days (from
 * `cabCertManDays`, `cabPricing.ts`), unit price = the man-day rate. Only engaged when the
 * caller supplies `data.cert` (a certification proposal); every other proposal's `items` keep
 * flowing through untouched, same conditional-by-shape posture `datanaRules.ts` documents for
 * its own five modules.
 */
function certPricedItems(cert: ProposalCertInput): ProposalItem[] {
  // R93 — the rate is resolved server-side from the org's stored setting before
  // this runs (`business.service.ts` `resolveCabRate`); `CAB_RATE_DEFAULT` is
  // OD's own fallback for an org that has never set one.
  const rate = Number(cert.ratePerMd) > 0 ? Number(cert.ratePerMd) : CAB_RATE_DEFAULT;
  const adj = typeof cert.complexity === "string"
    ? (CAB_PROPOSAL_COMPLEXITY_ADJ[cert.complexity] ?? 0)
    : cabComplexityAdj(cert.standards, cert.complexity || {});
  const { ia, sa } = cabCertManDays(cert.personnel, cert.standards, adj);
  return [
    { description: "Initial certification audit (Stage 1 + Stage 2)", qty: ia, unitPrice: rate },
    { description: "Surveillance audit 1", qty: sa, unitPrice: rate },
    { description: "Surveillance audit 2", qty: sa, unitPrice: rate },
  ];
}

/** OD `proposalStart`/`certProposalStart` both open a proposal at 11% tax. */
export const OD_DEFAULT_TAX_PCT = 11;
/** OD `certProposalStart` (js/modules.js:2221) — a certification proposal is always IDR. */
const CERT_PROPOSAL_CURRENCY = "IDR";
/** OD `certProposalStart` — a certification proposal is always the audit contract type. */
const CERT_PROPOSAL_CONTRACT_TYPE_ID = "ct-svc-audit";

function assertValidCertInput(raw: unknown): ProposalCertInput {
  const c = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(c.standards) || !c.standards.length || c.standards.some((s) => typeof s !== "string")) {
    throw new BadRequestError("cert.standards must be a non-empty array of strings", "INVALID_CERT_STANDARDS");
  }
  const personnel = Number(c.personnel);
  if (!Number.isFinite(personnel) || personnel <= 0) throw new BadRequestError("cert.personnel must be > 0", "INVALID_CERT_PERSONNEL");
  return {
    standards: c.standards as string[],
    personnel,
    sites: c.sites !== undefined ? Number(c.sites) : undefined,
    complexity: c.complexity as ProposalCertInput["complexity"],
    ratePerMd: c.ratePerMd !== undefined ? Number(c.ratePerMd) : undefined,
  };
}

/** Validates and normalizes proposal `data`, computing server-authoritative `totals`. Returns
 *  the (possibly unmodified) data object with `totals` set — callers write the return value back
 *  into `input.data`/`r.data`, never the caller's original object. */
export function assertValidProposalData(
  data: Record<string, unknown> | undefined,
  opts: { isCreate?: boolean } = {},
): Record<string, unknown> {
  const d = data ?? {};

  const cert = d.cert !== undefined ? assertValidCertInput(d.cert) : undefined;

  // OD `certProposalStart` (js/modules.js:2221) fixes a certification proposal's currency to
  // IDR and its contract type to `ct-svc-audit`; the man-day rate is quoted per IDR man-day.
  if (cert && opts.isCreate) {
    if (!String(d.currency ?? "").trim()) d.currency = CERT_PROPOSAL_CURRENCY;
    if (!String(d.contractTypeId ?? "").trim()) d.contractTypeId = CERT_PROPOSAL_CONTRACT_TYPE_ID;
  }

  const currency = String(d.currency ?? "").trim();
  if (!currency) throw new BadRequestError("Proposal currency is required", "CURRENCY_REQUIRED");

  // Certification-proposal auto-pricing: `data.cert` present overrides any client-supplied
  // `items` with the server-computed man-day items — same "server never trusts client totals"
  // posture `computeProposalTotals` already takes for `totals` itself, extended one level up.
  const items = assertValidItems(cert ? certPricedItems(cert) : (d.items ?? []));

  const discount = Number(d.discount ?? 0);
  if (!Number.isFinite(discount) || discount < 0) throw new BadRequestError("Discount must be >= 0", "INVALID_DISCOUNT");

  // OD opens every proposal at 11% — `proposalStart` (js/modules.js:2502) and
  // `certProposalStart` (:2221) both hard-code `taxPct:11`. Defaulting to 0 quoted every
  // proposal created without an explicit rate tax-free. Applied on create only: re-defaulting
  // on update would silently re-tax records already saved under the old default.
  const taxPct = Number(d.taxPct ?? (opts.isCreate ? OD_DEFAULT_TAX_PCT : 0));
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) throw new BadRequestError("Tax % must be between 0 and 100", "INVALID_TAX_PCT");

  if (d.contractTypeId !== undefined && d.contractTypeId !== "" && !String(d.contractTypeId).trim()) {
    throw new BadRequestError("contractTypeId must be a non-empty string", "INVALID_CONTRACT_TYPE");
  }
  if (d.clauseIds !== undefined) {
    if (!Array.isArray(d.clauseIds) || d.clauseIds.some((c) => typeof c !== "string" || !c.trim())) {
      throw new BadRequestError("clauseIds must be an array of non-empty strings", "INVALID_CLAUSE_IDS");
    }
  }

  const totals = computeProposalTotals(items, discount, taxPct);
  return { ...d, currency, items, discount, taxPct, totals };
}
