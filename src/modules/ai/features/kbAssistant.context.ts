/**
 * Pure prompt/answer helpers for `kb-assistant.feature.ts` and the public
 * marketing-site endpoint (`../public/kbPublic.routes.ts`). No DB, no AI.
 */
import { z } from "zod";
import { citeList, truncateForPrompt } from "./context";

/** One retrieved passage the model may answer from. */
export interface KbSource {
  title: string;
  summary?: string | null;
  content: string;
  /** Carried through to the citation (article id, post slug, …). */
  ref: Record<string, string>;
}

const PER_SOURCE_CHARS = 2500;

export const answerSchema = z.object({
  answer: z.string(),
  answered: z.boolean(),
  sourceIds: z.array(z.string()).default([]),
});
export type AnswerDraft = z.infer<typeof answerSchema>;

export const KB_ANSWER_SYSTEM =
  "You answer questions using ONLY the knowledge-base articles provided, each tagged with a numeric id. " +
  "Answer in a few short paragraphs or bullet points, and cite the article ids you used in square brackets, e.g. [1]. " +
  "If the articles do not cover the question, set `answered` to false and say briefly that the knowledge base does not cover it — do not answer from general knowledge. " +
  "List the ids you relied on in `sourceIds`.";

export const NOT_COVERED = "The knowledge base doesn't cover this question yet.";

/** The user turn: the question, optional extra context, and the sources numbered 1..n. */
export function buildAnswerPrompt(question: string, sources: KbSource[], context?: string): string {
  const cite = citeList(sources.map((s, i) => ({
    id: String(i + 1),
    text: `${s.title}${s.summary ? ` — ${s.summary}` : ""}\n${truncateForPrompt(s.content, PER_SOURCE_CHARS)}`,
  })));
  return [
    `Question: ${question}`,
    context ? `Context:\n${context}` : null,
    `Knowledge-base articles:\n${cite}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * Keeps only citations to sources that exist; an answer that cites nothing is
 * treated as not answered (the model must ground every answer in a source).
 */
export function finalizeAnswer<C>(draft: AnswerDraft, sources: KbSource[], cite: (s: KbSource) => C): { answer: string; answered: boolean; citations: C[] } {
  const ids = [...new Set(draft.sourceIds.map((id) => id.replace(/[[\]\s]/g, "")))].filter((id) => /^\d+$/.test(id));
  const used = ids.map((id) => sources[Number(id) - 1]).filter((s): s is KbSource => !!s);
  const answered = draft.answered && used.length > 0;
  // An "answer" the model gave without citing anything is dropped, not shown.
  const answer = answered ? draft.answer.trim() : (!draft.answered && draft.answer.trim()) || NOT_COVERED;
  return { answer, answered, citations: answered ? used.map(cite) : [] };
}
