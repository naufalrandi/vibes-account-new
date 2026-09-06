/**
 * Exelera CAB (Certification Body, ISO/IEC 17021) man-day pricing engine.
 *
 * Ported verbatim from the design source's client-side implementation
 * (`js/core.js` in the OD project) — the backend previously stored `exelera`
 * business records (`ex-cab` module) as opaque `BusinessRecord.data` JSON
 * blobs with none of this math enforced server-side. Line refs below are
 * against `js/core.js` in the design source repo, not this backend.
 *
 * - `cabInitialDays` (core.js:3977-3982) — MD5: initial audit time (Stage 1 +
 *   Stage 2 combined) from effective personnel, looked up in Table QMS 1
 *   (`CAB_QMS1`, core.js:3952) or, for an ISMS-bearing scope, the larger
 *   ISO/IEC 27006-1 Annex C table (`CAB_ISMS`, core.js:3953). Multi-standard
 *   (IMS) scopes get +55% man-days per extra standard, then the overall
 *   complexity adjustment is applied multiplicatively.
 * - `cabAuditDays` (core.js:3983-3989) — MD1: per-audit-type days, fractions
 *   of the initial (Stage 1 = 34%, Stage 2 = 66%, Recertification = 2/3,
 *   Surveillance = 1/3) of the initial MD5 total.
 * - `cabSample` (core.js:3991) — IAF MD 1 site-sampling rule: for N > 1
 *   sites, ceil(k·sqrt(N)) sites are sampled, k = 1.0 for Stage 1/Stage 2,
 *   0.8 for Recertification, 0.6 for Surveillance.
 * - `cabComplexityAdj`/`cabStdAdj` (core.js:3963-3967) — per-standard
 *   complexity table (`CAB_COMPLEXITY`, core.js:3957-3962) mapping a
 *   Low/Standard/High rating to a −/0/+ percentage adjustment; this backend
 *   only receives an overall Low/Standard/High rating per standard (no
 *   per-factor breakdown UI exists here), which is exactly the fallback path
 *   OD's own `cabFactorRating` takes when no per-factor scores are recorded
 *   (uniform rating across all factors of a standard collapses the weighted
 *   sum back down to the standard's own level percentage — see
 *   `cabFactorPct`/`cabStdAdj`). The overall adjustment is the average across
 *   selected standards, capped at −30% (core.js:3966).
 * - `inqManDays` (modules.js:2207) — commercial-funnel pricing: initial audit
 *   (Stage 1 + Stage 2) + 2 surveillance audits.
 * - `cabRate`/`cabSetRate` (modules.js:2204-2205) — IDR 8,000,000/man-day
 *   default rate, overridable; "man-days are fixed by MD5 / ISO 17021 and are
 *   not discounted — negotiation adjusts price only."
 * - `cabIssueCert`/`cabDecision` (core.js:3996, 4102) — a certification
 *   decision may only **grant** (issue a certificate) when there is no open
 *   Major nonconformity; cert numbers are `EXL-<n>-<year>`.
 */

export type CabAuditType = "Stage 1" | "Stage 2" | "Surveillance 1" | "Surveillance 2" | "Recertification";
export type CabComplexityLevel = "Low" | "Standard" | "High";
export type CabNcGrade = "Major" | "Minor" | "OFI";

export interface CabFinding {
  grade: CabNcGrade;
  open: boolean;
}

/** MD5 Table QMS 1 (core.js:3952) — [personnel-upper-bound, man-days] pairs, ascending. */
export const CAB_QMS1: readonly [number, number][] = [
  [5, 1.5], [10, 2], [15, 2.5], [25, 3], [45, 4], [65, 5], [85, 6], [125, 7], [175, 8], [275, 9],
  [425, 10], [625, 11], [875, 12], [1175, 13], [1550, 14], [2025, 15], [2675, 16], [3450, 17],
  [4350, 18], [5450, 19], [6800, 20],
];

/** MD5 ISO/IEC 27006-1 Annex C table (core.js:3953) — used when the scope includes an ISMS standard. */
export const CAB_ISMS: readonly [number, number][] = [
  [10, 5], [15, 6], [25, 7], [45, 8.5], [65, 10], [85, 11], [125, 12], [175, 13], [275, 14],
  [425, 15], [625, 16.5], [875, 17.5], [1175, 18.5], [1550, 19.5], [2025, 21], [2675, 22],
  [3450, 23], [4350, 24], [5450, 25], [6800, 26], [8500, 27], [10700, 28],
];

/** Standard that triggers the ISMS table (core.js:3954). */
export const CAB_ISMS_STANDARD = "ISO/IEC 27001:2022";

export function cabIsIsms(standards: readonly string[]): boolean {
  return standards.includes(CAB_ISMS_STANDARD);
}

/** Per-standard complexity level → adjustment (core.js:3957-3962). `Standard` is always 0. */
export const CAB_COMPLEXITY_LEVELS: Record<string, Record<CabComplexityLevel, number>> = {
  "ISO 9001:2015": { Low: -0.10, Standard: 0, High: 0.15 },
  "ISO 14001:2015": { Low: -0.10, Standard: 0, High: 0.20 },
  "ISO 45001:2018": { Low: -0.10, Standard: 0, High: 0.25 },
  [CAB_ISMS_STANDARD]: { Low: -0.10, Standard: 0, High: 0.30 },
};

/**
 * R97/R714 — the four named complexity factors each standard is scored against
 * (core.js:3959-3964). One factor carries `1/n` of that standard's full swing,
 * so four `Above` factors sum to exactly its `High` level.
 */
export const CAB_COMPLEXITY_FACTORS: Record<string, readonly string[]> = {
  "ISO 9001:2015": ["Process complexity & interactions", "Regulated / safety-critical products", "Degree of automation vs manual work", "Number of similar / repetitive processes"],
  "ISO 14001:2015": ["Number & significance of environmental aspects", "Regulatory permits & obligations", "Waste, emissions & discharge complexity", "Environmental sensitivity of location"],
  "ISO 45001:2018": ["Hazard severity & high-risk activities", "Incident / injury history", "Workforce hazard exposure", "Contractor & multi-site safety complexity"],
  [CAB_ISMS_STANDARD]: ["Criticality & sensitivity of information", "Technology diversity (platforms, networks)", "Extent of outsourcing / third parties", "Information system development activity"],
};

export type CabFactorRating = "Below" | "Average" | "Above";

/** OD `cabFactorRating` (core.js:3984) — a stored per-factor rating wins over the coarse level. */
export function cabFactorRating(
  std: string,
  index: number,
  factorScores: Record<string, CabFactorRating[]> | undefined,
  level: CabComplexityLevel | undefined,
): CabFactorRating {
  const stored = factorScores?.[std]?.[index];
  if (stored) return stored;
  if (level === "High") return "Above";
  if (level === "Low") return "Below";
  return "Average";
}

/** OD `cabFactorPct` (core.js:3988). */
export function cabFactorPct(std: string, rating: CabFactorRating): number {
  const levels = CAB_COMPLEXITY_LEVELS[std];
  const factors = CAB_COMPLEXITY_FACTORS[std];
  if (!levels || !factors?.length) return 0;
  if (rating === "Above") return levels.High / factors.length;
  if (rating === "Below") return levels.Low / factors.length;
  return 0;
}

/** OD `cabStdAdj` (core.js:3991) — the sum of one standard's four factor contributions. */
export function cabStdAdj(
  std: string,
  level: CabComplexityLevel | undefined,
  factorScores?: Record<string, CabFactorRating[]>,
): number {
  const factors = CAB_COMPLEXITY_FACTORS[std];
  if (!factors) return 0;
  let sum = 0;
  for (let i = 0; i < factors.length; i++) sum += cabFactorPct(std, cabFactorRating(std, i, factorScores, level));
  return sum;
}

/**
 * Overall complexity adjustment across the certified standards (core.js:3966).
 * `complexity` maps standard → Low/Standard/High; a standard absent from the
 * map (or not in `CAB_COMPLEXITY_LEVELS`) contributes 0 (`Standard`).
 * Averaged across the given standards, capped at −30%.
 */
export function cabComplexityAdj(
  standards: readonly string[],
  complexity: Record<string, CabComplexityLevel> = {},
  factorScores?: Record<string, CabFactorRating[]>,
): number {
  if (!standards.length) return 0;
  let sum = 0;
  let k = 0;
  for (const std of standards) {
    if (!CAB_COMPLEXITY_LEVELS[std]) continue;
    sum += cabStdAdj(std, complexity[std], factorScores);
    k++;
  }
  const adj = k ? sum / k : 0;
  return Math.max(-0.3, adj);
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** MD5: initial audit (Stage 1 + Stage 2 combined) man-days (core.js:3977-3982). */
export function cabInitialDays(personnel: number, standards: readonly string[], adj = 0): number {
  const p = Math.max(1, personnel || 1);
  const table = cabIsIsms(standards) ? CAB_ISMS : CAB_QMS1;
  let base = table[table.length - 1][1];
  for (const [upTo, days] of table) {
    if (p <= upTo) { base = days; break; }
  }
  const n = standards.length || 1;
  // IMS uplift: +55% per additional standard beyond the first (core.js:3980).
  const days = base * (1 + (n - 1) * 0.55) * (1 + adj);
  return roundHalf(days);
}

/** MD1: man-days for a specific audit type, derived from the MD5 initial total (core.js:3983-3989). */
export function cabAuditDays(type: CabAuditType, personnel: number, standards: readonly string[], adj = 0): number {
  const init = cabInitialDays(personnel, standards, adj);
  if (type === "Stage 1") return roundHalf(init * 0.34);
  if (type === "Stage 2") return roundHalf(init * 0.66);
  if (type === "Recertification") return roundHalf(init * (2 / 3));
  return roundHalf(init / 3); // Surveillance 1 / Surveillance 2 (~1/3 of initial).
}

/** IAF MD 1 site-sampling rule: sqrt(N) sample size for multi-site scopes (core.js:3991). */
export function cabSampleSize(sites: number, type: CabAuditType): number {
  const n = Math.max(1, sites || 1);
  if (n <= 1) return 1;
  const k = type === "Stage 1" || type === "Stage 2" ? 1 : type === "Recertification" ? 0.8 : 0.6;
  return Math.ceil(k * Math.sqrt(n));
}

/** Default man-day rate (IDR), mirrors OD's `cabRate()` default (modules.js:2204). */
export const CAB_RATE_DEFAULT = 8_000_000;

export interface CabCertManDays {
  /** Initial audit (Stage 1 + Stage 2) man-days. */
  ia: number;
  /** Man-days per surveillance audit. */
  sa: number;
  /** ia + 2×sa, the commercial-funnel total (modules.js:2207 `inqManDays`). */
  total: number;
}

/** Initial audit + 2 years of surveillance man-days — the commercial sales-funnel total
 *  (`inqManDays`, modules.js:2207) used to auto-price a certification proposal. */
export function cabCertManDays(personnel: number, standards: readonly string[], adj = 0): CabCertManDays {
  const ia = cabInitialDays(personnel, standards, adj);
  const sa = cabAuditDays("Surveillance 1", personnel, standards, adj);
  return { ia, sa, total: roundHalf(ia + 2 * sa) };
}

/**
 * Certificate issuance gate (`cabDecision`'s `openMaj` disable, core.js:4094 /
 * `cabDecisionView`): a certificate may be granted only when there is no
 * OPEN Major nonconformity. Open Minor/OFI findings do not block issuance.
 */
export function canIssueCertificate(findings: readonly CabFinding[]): boolean {
  return !findings.some((f) => f.open && f.grade === "Major");
}
