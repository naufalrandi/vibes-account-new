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

/**
 * OD's own line-item shape — `propFormSave` (js/modules.js:2488) writes
 * `{id, courseId, courseCode, desc, qty, unit}` and `certProposalStart`'s `mk()`
 * (:2220) writes `{id, desc, qty, unit}`. All nine seeded proposals
 * (`src/db/seeders/data/businessRecords/proposals.json`) carry it, so
 * normalising to anything else dropped their `id`/`courseCode` on the first save
 * and rejected them outright on the second.
 *
 * `courseLink` is this codebase's own addition (the FE's catalog deep-link), kept
 * alongside OD's keys.
 */
export interface ProposalItem {
  id?: string;
  courseId?: string;
  courseCode?: string;
  courseLink?: string;
  desc: string;
  qty: number;
  unit: number;
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

/** Mirrors OD's `propCalc` (modules.js ~L2447) verbatim: sub = Σ qty*unit, afterDisc floors
 *  at 0, tax = afterDisc * taxPct/100, total = afterDisc + tax. */
export function computeProposalTotals(items: ProposalItem[], discount: number, taxPct: number): ProposalTotals {
  const sub = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unit) || 0), 0);
  const disc = Number(discount) || 0;
  const afterDisc = Math.max(0, sub - disc);
  const tax = afterDisc * ((Number(taxPct) || 0) / 100);
  return { sub, disc, tax, total: afterDisc + tax };
}

/**
 * Normalises each line to OD's `{id, courseId, courseCode, desc, qty, unit}`.
 * `description`/`unitPrice` — the spellings this port used before it was aligned
 * to OD — are still accepted on input so a record saved under the old shape can
 * still be edited; only OD's keys are ever written back.
 */
function assertValidItems(itemsRaw: unknown): ProposalItem[] {
  if (!Array.isArray(itemsRaw)) throw new BadRequestError("Proposal items must be an array", "INVALID_ITEMS");
  return itemsRaw.map((raw, idx) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const desc = String(item.desc ?? item.description ?? "").trim();
    if (!desc) throw new BadRequestError(`Item ${idx + 1}: description is required`, "INVALID_ITEM");
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestError(`Item ${idx + 1}: qty must be greater than 0`, "INVALID_ITEM");
    const unit = Number(item.unit ?? item.unitPrice);
    if (!Number.isFinite(unit) || unit < 0) throw new BadRequestError(`Item ${idx + 1}: unit price must be >= 0`, "INVALID_ITEM");
    const out: ProposalItem = { desc, qty, unit };
    // OD mints `id: rUid('pi')` per line and snapshots the linked course's code
    // beside its id; both are carried through so an edit does not destroy them.
    if (item.id !== undefined && item.id !== "") out.id = String(item.id);
    if (item.courseId !== undefined && item.courseId !== "") out.courseId = String(item.courseId);
    if (item.courseCode !== undefined && item.courseCode !== "") out.courseCode = String(item.courseCode);
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
  /**
   * R98 / OD `certProposalStart` (js/modules.js:2221) prices from `a.mdIA`/`a.mdSA`/`a.mdTotal`
   * — the man-days the Application Review recorded at review time (`cabInqReview`,
   * js/modules.js:2215) — not from the proposal request. `business.service.ts` reads them off
   * the approved AR and stamps them here; recomputing locally is only the fallback for a record
   * saved before they were carried.
   */
  mdIA?: number;
  mdSA?: number;
  mdTotal?: number;
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
/**
 * R93 — the rate is resolved server-side from the org's stored setting before
 * this runs (`business.service.ts` `resolveCabRate`); `CAB_RATE_DEFAULT` is
 * OD's own fallback for an org that has never set one.
 */
function certRate(cert: ProposalCertInput): number {
  return Number(cert.ratePerMd) > 0 ? Number(cert.ratePerMd) : CAB_RATE_DEFAULT;
}

/** R98 — the approved Application Review's own man-days win; the funnel recompute is the fallback. */
function certManDays(cert: ProposalCertInput): { ia: number; sa: number; total: number } {
  const [ia, sa, total] = [cert.mdIA, cert.mdSA, cert.mdTotal].map(Number);
  if ([ia, sa, total].every((n) => Number.isFinite(n) && n > 0)) return { ia, sa, total };
  const adj = typeof cert.complexity === "string"
    ? (CAB_PROPOSAL_COMPLEXITY_ADJ[cert.complexity] ?? 0)
    : cabComplexityAdj(cert.standards, cert.complexity || {});
  return cabCertManDays(cert.personnel, cert.standards, adj);
}

function certPricedItems(cert: ProposalCertInput): ProposalItem[] {
  const rate = certRate(cert);
  const { ia, sa } = certManDays(cert);
  return [
    { desc: "Initial certification audit (Stage 1 + Stage 2)", qty: ia, unit: rate },
    { desc: "Surveillance audit 1", qty: sa, unit: rate },
    { desc: "Surveillance audit 2", qty: sa, unit: rate },
  ];
}

/** OD `proposalStart`/`certProposalStart` both open a proposal at 11% tax. */
export const OD_DEFAULT_TAX_PCT = 11;
/** OD `certProposalStart` (js/modules.js:2221) — a certification proposal is always IDR. */
const CERT_PROPOSAL_CURRENCY = "IDR";
/** OD `certProposalStart` — a certification proposal is always the audit contract type. */
const CERT_PROPOSAL_CONTRACT_TYPE_ID = "ct-svc-audit";

/**
 * R99/R532 — `ct-svc-audit`'s own `defaultTerms`, which OD seeds onto a
 * certification proposal as `termIds`. The seeded contract type carries the
 * same list (`src/db/seeders/data/businessRecords/contractTypes.json`); it is
 * mirrored here because a proposal is priced server-side with no contract-type
 * lookup in the request.
 */
const CERT_PROPOSAL_TERM_IDS = [
  "cl-svc-scope", "cl-svc-fees", "cl-svc-term", "cl-svc-liab", "cl-common-conf", "cl-common-law",
] as const;

/** OD `ssMoney` (js/modules.js:4747) — `Math.round(n||0).toLocaleString('en-US')`, so the
 *  note reads `IDR 8,000,000/md` (comma groups), not id-ID's `8.000.000`. */
function ssMoney(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n) || 0);
}

/**
 * R99 / OD `certProposalStart` (js/modules.js:2221) — the audit-time note the
 * quote carries.
 */
function certNotes(cert: ProposalCertInput): string {
  const { ia, sa, total } = certManDays(cert);
  return `Audit time: IA ${ia} + SA ${sa}\u00d72 = ${total} md @ IDR ${ssMoney(certRate(cert))}/md (MD5/27006-1).`;
}

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
    mdIA: c.mdIA !== undefined ? Number(c.mdIA) : undefined,
    mdSA: c.mdSA !== undefined ? Number(c.mdSA) : undefined,
    mdTotal: c.mdTotal !== undefined ? Number(c.mdTotal) : undefined,
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
    // R99/R532 — the audit contract type's clauses, and OD's own audit-time
    // note, so the quote states the man-days it was priced from.
    if (!Array.isArray(d.termIds) || d.termIds.length === 0) d.termIds = [...CERT_PROPOSAL_TERM_IDS];
    if (!String(d.notes ?? "").trim()) d.notes = certNotes(cert);
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
