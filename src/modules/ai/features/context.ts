/** Helpers for building prompt context. Pure functions — no DB, no AI. */

const REDACTED = "[redacted]";

// Order matters: the formatted patterns run before the bare digit runs they contain.
const PII_PATTERNS: RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g, // NPWP 00.000.000.0-000.000
  /(?:\+|\b)(?:62|0)8\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,5}\b/g, // Indonesian mobile
  /\+\d{1,3}[-\s]?\(?\d{1,4}\)?(?:[-\s]?\d{2,4}){2,4}\b/g, // international phone
  /\b\d{10,20}\b/g, // NIK (16 digits), bare NPWP (15/16), bank-account-like runs
  /\b\d{3,4}(?:[-\s]\d{3,4}){2,4}\b/g, // grouped account / card / phone numbers
];

/** Replace emails, phone numbers, NIK, NPWP and bank-account-like numbers with "[redacted]". */
export function redactPii(text: string): string {
  return PII_PATTERNS.reduce((out, re) => out.replace(re, REDACTED), text);
}

/** `text` cut to `maxChars`, with a marker saying how much was dropped. */
export function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} characters]`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable (sorted-key) JSON of `value`, truncated to `maxChars`. */
export function jsonForPrompt(value: unknown, maxChars: number): string {
  return truncateForPrompt(JSON.stringify(sortKeys(value)) ?? "null", maxChars);
}

/** Sources as `[id] text` lines, so the model can cite them by id. */
export function citeList(items: { id: string; text: string }[]): string {
  return items.map((i) => `[${i.id}] ${i.text.replace(/\s+/g, " ").trim()}`).join("\n");
}
