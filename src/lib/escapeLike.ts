/** Escape `%`, `_` and `\` so user input matches literally inside a LIKE/ILIKE pattern. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
