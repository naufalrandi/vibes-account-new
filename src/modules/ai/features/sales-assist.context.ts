/** Pure prompt/context builders for `sales-assist.feature.ts` — no DB, no AI. */
import type { BusinessRecordView } from "../../business/business.service";
import { SERVICE_CATALOG } from "../../business/inquiryRules";
import { jsonForPrompt, redactPii, truncateForPrompt } from "./context";

/**
 * The questionnaire (`sq`) keys per service, mirroring the frontend's
 * `SERVICE_CATALOG[].sq` / `sqByVariant` + `SQ_COMMON` (fe-vibes-new/lib/sales/inquiries.ts).
 * Only these keys are ever returned as suggested scoping answers.
 */
const SQ_COMMON = ["timeline"];
const SQ_KEYS: Record<string, string[]> = {
  impl: ["frameworks", "sites", "maturity", "targetCert", "headcount"],
  audit: ["frameworks", "scope", "objective", "auditorDays"],
  assess: ["frameworks", "scope", "currentState"],
  comp: ["topic", "headcount", "mode", "dates", "scheme"],
};
const SQ_BY_VARIANT: Record<string, string[]> = {
  // In-house training skips SQ_COMMON; `courseId` is a catalog pick, never AI-filled.
  "comp|In-house training": ["headcount", "window", "mode", "venue", "venueCity", "language"],
};

export function sqKeysFor(service: string | undefined, variant: string | undefined): string[] {
  const byVariant = SQ_BY_VARIANT[`${service}|${variant}`];
  if (byVariant) return byVariant;
  return [...SQ_COMMON, ...(SQ_KEYS[service ?? ""] ?? [])];
}

/** Keeps only the allowed keys with non-empty string values. */
export function pickSqAnswers(answers: { key: string; value: string }[], allowed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers) {
    const v = a.value.trim();
    if (allowed.includes(a.key) && v) out[a.key] = v;
  }
  return out;
}

export const SERVICE_IDS = SERVICE_CATALOG.map((s) => s.id) as [string, ...string[]];

export function serviceCatalogForPrompt(): string {
  return SERVICE_CATALOG.map((s) => `- ${s.id}: ${s.name} (variants: ${s.variants.join(", ")})`).join("\n");
}

const OMIT_KEYS = new Set(["activity", "confirmToken", "ack"]);

/** A business record as prompt JSON: no activity trail / tokens, PII redacted. */
export function recordForPrompt(r: BusinessRecordView, maxChars = 4000): string {
  const data = Object.fromEntries(Object.entries(r.data ?? {}).filter(([k]) => !OMIT_KEYS.has(k)));
  return redactPii(jsonForPrompt({ id: r.id, code: r.code, title: r.title, status: r.status, data }, maxChars));
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** A clause library entry as a citable `[id]` line. */
export function clauseLine(c: BusinessRecordView): { id: string; text: string } {
  const d = c.data as Record<string, unknown>;
  const body = truncateForPrompt(stripHtml(String(d.body ?? "")), 300);
  return { id: c.id, text: `${c.title} (${String(d.category ?? "")}${d.domain ? `, ${String(d.domain)}` : ""}): ${body}` };
}

/** Clauses a service contract / proposal may use: Service + Common domains (and untagged). */
export function isServiceClause(c: BusinessRecordView): boolean {
  const domain = String((c.data as Record<string, unknown>).domain ?? "");
  return domain === "" || domain === "Service" || domain === "Common";
}

export function contractTypeLine(t: BusinessRecordView): { id: string; text: string } {
  const d = t.data as Record<string, unknown>;
  const defaults = Array.isArray(d.defaultTerms) ? d.defaultTerms.map(String).join(", ") : "";
  return { id: t.id, text: `${t.title}${defaults ? ` — default clauses: ${defaults}` : ""}` };
}

/** Drops suggestions whose id isn't in `valid`, and duplicates. */
export function keepKnown<T>(items: T[], idOf: (t: T) => string, valid: Set<string>): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const id = idOf(t);
    if (!valid.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
