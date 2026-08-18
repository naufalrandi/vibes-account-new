import { ImplementationRecord } from "../../db/models";

/**
 * Policies vocabulary + derivations — the server-side half of OD's `pol*`
 * helpers (index.html:10100–10112). Policy bodies live 1:1 in
 * `implementation_records.data`; this module owns the framework-coded ID
 * scheme, the integer version bump, and the review-cadence math.
 */

/** OD `POL_CATS` (10100). */
export const POL_CATS = ["High-Level Policy", "Specific Policy"] as const;

/** OD `POL_FW_CODE` (10104) — framework → ID code for High-Level policies. */
export const POL_FW_CODE: Record<string, string> = {
  "ISO 9001:2015": "QMS", "ISO 14001:2015": "EMS", "ISO 45001:2018": "OHSM",
  "ISO/IEC 27001:2022": "ISMS", "ISO/IEC 27701:2025": "PIMS",
  "ISO 22301:2019": "BCMS", "ISO 37001:2025": "ABMS",
};

/** OD `POL_FREQ_MO` (10105) — review cadence in months. */
export const POL_FREQ_MO: Record<string, number> = {
  Quarterly: 3, "Semi-annually": 6, Annually: 12, "Every 2 years": 24, Custom: 12,
};

/** OD `polNextReview` (10111): effective date + frequency → next-review ISO stamp ("" without an effective date). */
export function polNextReview(effectiveDate: unknown, reviewFreq: unknown): string {
  if (!effectiveDate || typeof effectiveDate !== "string") return "";
  const d = new Date(effectiveDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + (POL_FREQ_MO[String(reviewFreq ?? "")] ?? 12));
  return d.toISOString();
}

/** OD `polSave` versioning (10847): integer bump — "1" → "2", blank → "1". */
export function polNextVersion(current: unknown): string {
  const n = Number.parseInt(String(current ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? String(n + 1) : "1";
}

/**
 * OD `polNum` + `polNewId` (10110): ONE number sequence per tenant across all
 * policies regardless of framework code, then `POL-<FWCODE>-NNNN` for a
 * High-Level policy whose first framework has a code, `POL-NNNN` otherwise.
 */
export async function policyCode(orgId: string, category: unknown, frameworks: string[] | undefined): Promise<string> {
  const rows = await ImplementationRecord.findAll({ where: { orgId, module: "policies" }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt((r.code || "").replace(/^POL-(?:[A-Z]+-)?/, "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const num = String(max + 1).padStart(4, "0");
  const fwc = String(category ?? "") === "High-Level Policy" && frameworks?.[0] ? POL_FW_CODE[frameworks[0]] : undefined;
  return fwc ? `POL-${fwc}-${num}` : `POL-${num}`;
}

/**
 * Field derivations OD applies on every policy save (`polSave` 10840):
 * `nextReview` is always recomputed from effective date + review frequency,
 * never hand-set. Returns a new object — the input is not mutated.
 */
export function derivePolicyData(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, nextReview: polNextReview(data.effectiveDate, data.reviewFreq ?? "Annually") };
}
