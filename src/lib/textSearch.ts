import { Op, literal, type WhereOptions } from "sequelize";
import { sequelize } from "../db/sequelize";
import { escapeLike } from "./escapeLike";

/**
 * Free-text retrieval over a few text columns: Postgres full-text search first,
 * a plain ILIKE-any-term fallback when FTS finds nothing (short words, other
 * languages the English stemmer mangles). `cols` are trusted column names from
 * code, never user input; the question is always escaped.
 */

type Literal = ReturnType<typeof literal>;

const MIN_TERM = 3;
const MAX_TERMS = 8;

const tsDoc = (cols: string[]) => `to_tsvector('english', ${cols.map((c) => `coalesce("${c}", '')`).join(" || ' ' || ")})`;
// plainto_tsquery ANDs every word, which misses most natural questions; turning
// `&` into `|` matches any term and lets ts_rank order by how many terms hit.
const tsQuery = (q: string) => `replace(plainto_tsquery('english', ${sequelize.escape(q)})::text, '&', '|')::tsquery`;

export function fullTextMatch(cols: string[], question: string): { where: Literal; rank: Literal } {
  return {
    where: literal(`${tsDoc(cols)} @@ ${tsQuery(question)}`),
    rank: literal(`ts_rank(${tsDoc(cols)}, ${tsQuery(question)})`),
  };
}

/** The distinct words of `question` worth matching (≥ 3 chars, at most 8). */
export function searchTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= MIN_TERM))].slice(0, MAX_TERMS);
}

/** Any term ILIKE any column; null when the question has no usable term. */
export function likeAnyMatch(cols: string[], question: string): WhereOptions | null {
  const terms = searchTerms(question);
  if (!terms.length) return null;
  return { [Op.or]: cols.flatMap((c) => terms.map((t) => ({ [c]: { [Op.iLike]: `%${escapeLike(t)}%` } }))) };
}
