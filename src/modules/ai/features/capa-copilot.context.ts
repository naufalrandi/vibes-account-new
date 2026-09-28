import type { RecordView } from "../../implementation/implementation.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { textSimilarity, topMatches } from "./triage.similarity";

/** Prompt-context builders for capa-copilot. Pure functions — no DB, no AI. */

const SIMILAR_MIN = 0.2;
const SIMILAR_LIMIT = 5;
const RECORD_CHARS = 6000;

export const d = (r: RecordView) => r.data as Record<string, unknown>;
export const s = (v: unknown) => (typeof v === "string" ? v : "");

/** The record's own text, used for similarity matching. */
export const recordText = (r: RecordView) =>
  [r.title, s(d(r).description), s(d(r).category), s(d(r).type), s(d(r).process), s(d(r).system)].join(" ");

/** The fields worth showing the model, PII-redacted. */
export function recordForPrompt(r: RecordView): string {
  const data = Object.fromEntries(Object.entries(d(r)).filter(([k]) => k !== "activity" && k !== "comments"));
  return redactPii(jsonForPrompt({ code: r.code, title: r.title, status: r.status, data }, RECORD_CHARS));
}

/** Past NCs/incidents of the same org whose text overlaps this one — found in code, not by the model. */
export function findSimilar(record: RecordView, peers: RecordView[]) {
  const text = recordText(record);
  // ponytail: token-overlap over every row of the org; move to pg_trgm if registers grow past a few thousand rows.
  return topMatches(peers, (p) => textSimilarity(text, recordText(p)), SIMILAR_MIN, SIMILAR_LIMIT).map(({ item }) => item);
}

export const similarSources = (items: RecordView[]) =>
  citeList(items.map((p) => ({
    id: p.code,
    text: redactPii(truncateForPrompt(
      `${p.title} (${p.status}). Root cause: ${s(d(p).rootCause) || s((d(p).cap as Record<string, unknown> | undefined)?.rca) || "not recorded"}. ` +
      `Corrective action: ${s(d(p).correctiveAction) || s((d(p).cap as Record<string, unknown> | undefined)?.correctiveAction) || "not recorded"}.`,
      600,
    )),
  })));
