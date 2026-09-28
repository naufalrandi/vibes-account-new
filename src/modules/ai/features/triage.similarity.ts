/** Deterministic text matching for the triage feature. Pure functions — no DB, no AI. */

const STOPWORDS = new Set(
  ("the and for with that this from have has had was were are is not but you your our their they them " +
    "there when what which who will would could should can been being into onto over under about after before " +
    "also only very more most some any all its it's his her him she he we us of to in on at by or an as be do " +
    "did does no yes please thank thanks hello dear regards yang dan di ke dari untuk dengan ini itu pada tidak").split(" "),
);

/** Lower-cased word tokens (≥ 3 chars, no stopwords), as a set. */
export function tokens(text: string): Set<string> {
  const words = text.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

/** Dice coefficient of the two texts' token sets, 0–1. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

/** Share of the query's tokens that appear in `doc`, 0–1 (for a short query against a long article). */
export function queryCoverage(query: string, doc: string): number {
  const q = tokens(query);
  if (!q.size) return 0;
  const d = tokens(doc);
  let hit = 0;
  for (const t of q) if (d.has(t)) hit++;
  return hit / q.size;
}

/** The candidates scoring at least `min`, best first, at most `limit`. */
export function topMatches<T>(items: T[], score: (item: T) => number, min: number, limit: number): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((m) => m.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
