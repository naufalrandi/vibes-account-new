import { redactPii, truncateForPrompt } from "./context";

/** Pure helpers for hr-assist (no DB, no AI) — unit-tested in hr-assist.unit.test.ts. */

const s = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
const clip = (v: unknown, n: number) => redactPii(truncateForPrompt(s(v), n));

const MONEY_RE = new RegExp(
  [
    String.raw`(?:Rp\.?|IDR|USD|US\$|EUR|SGD|AUD|GBP|MYR|\$|€|£)\s?\d(?:[\d.,]|\s(?=\d))*(?:\s?(?:juta|ribu|jt|rb|million|thousand|k|m)\b)?`, // currency + amount
    String.raw`\b\d[\d.,]*\s?(?:rupiah|juta|ribu|dollars?|euros?)\b`, // amount + currency word
    String.raw`\b\d{1,3}(?:[.,]\d{3}){1,}(?:[.,]\d+)?\b`, // 1.000.000 / 1,000,000
  ].join("|"),
  "gi",
);

/** Money amounts (salary, allowances, penalties) → "[amount]", on top of `redactPii`. */
export function redactAmounts(text: string): string {
  return redactPii(text).replace(MONEY_RE, "[amount]");
}

/**
 * The candidate's professional record only — education, experience, interview outcomes and
 * test results. Name, contact details, rating, notes, offer and contract terms never leave here.
 */
export function candidateProfessionalProfile(data: Record<string, unknown>): Record<string, unknown> {
  return {
    education: arr(data.education).map((e) => ({ level: s(e.level), field: clip(e.field, 200), institution: clip(e.institution, 200), year: s(e.year) })),
    experience: arr(data.experience).map((e) => ({ title: clip(e.title, 200), organisation: clip(e.org, 200), from: s(e.from), to: s(e.to) })),
    interviews: arr(data.interviews).map((i) => ({ type: s(i.type), date: s(i.date), outcome: s(i.outcome), note: redactAmounts(truncateForPrompt(s(i.note), 1500)) })),
    tests: arr(data.tests).map((t) => ({
      name: clip(t.name, 200), result: s(t.result),
      score: typeof t.scorePct === "number" ? `${t.scorePct}%` : typeof t.score === "number" ? `${t.score}/${t.max ?? "?"}` : "",
    })),
  };
}

// ---- contract clauses -----------------------------------------------------------------------------

/** Standard clauses an employment contract usually carries — the checklist contract-review compares against. */
export const STANDARD_CONTRACT_CLAUSES: { key: string; name: string }[] = [
  { key: "parties", name: "Parties and identification" },
  { key: "position", name: "Position, duties and reporting line" },
  { key: "term", name: "Start date, contract type and term" },
  { key: "probation", name: "Probation period" },
  { key: "place", name: "Place of work" },
  { key: "hours", name: "Working hours and overtime" },
  { key: "remuneration", name: "Remuneration and payment" },
  { key: "benefits", name: "Benefits and social security" },
  { key: "leave", name: "Annual leave and other leave" },
  { key: "confidentiality", name: "Confidentiality" },
  { key: "ip", name: "Intellectual property" },
  { key: "data-protection", name: "Personal data protection" },
  { key: "conduct", name: "Code of conduct and company rules" },
  { key: "conflict", name: "Conflict of interest and outside work" },
  { key: "termination", name: "Termination and notice" },
  { key: "post-termination", name: "Return of property and post-employment obligations" },
  { key: "disputes", name: "Governing law and dispute resolution" },
  { key: "entire", name: "Entire agreement and amendments" },
];

export interface ContractClauseLike { title?: string; category?: string; body?: string; include?: boolean }

/** Included clauses as `[n] title (category): body` lines with amounts and PII redacted. */
export function contractClauseLines(clauses: ContractClauseLike[], maxChars = 1500): { id: string; text: string }[] {
  return clauses
    .filter((c) => c.include !== false && (s(c.title) || s(c.body)))
    .map((c, i) => ({
      id: String(i + 1),
      text: `${s(c.title) || "(untitled)"}${s(c.category) ? ` (${s(c.category)})` : ""}: ${redactAmounts(truncateForPrompt(s(c.body), maxChars))}`,
    }));
}

/** Only checklist keys the model returned, in checklist order. */
export function missingClauses(keys: string[]): { key: string; name: string }[] {
  const want = new Set(keys.map((k) => k.trim().toLowerCase()));
  return STANDARD_CONTRACT_CLAUSES.filter((c) => want.has(c.key));
}
