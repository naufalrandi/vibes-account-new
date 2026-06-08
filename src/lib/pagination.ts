/**
 * Shared list pagination for the "hybrid" DataTable contract.
 *
 * Endpoints return the full filtered set by default (so the frontend's
 * client-side DataTable keeps working unchanged). When a caller passes
 * `?limit=` (and optionally `?page=`), the result is sliced server-side and the
 * response `meta` reports the real `page` / `limit` / `total` — ready for a
 * future server-side table mode without changing the contract.
 */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

const MAX_LIMIT = 200;

function toInt(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse `page` / `limit` query params. `limit === null` means "return everything". */
export function parsePageQuery(query: { page?: unknown; limit?: unknown }): { page: number; limit: number | null } {
  const page = Math.max(1, toInt(query.page) ?? 1);
  const rawLimit = toInt(query.limit);
  const limit = rawLimit == null ? null : Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit };
}

/** Slice an already-filtered array into a page and build its `meta`. */
export function paginate<T>(rows: T[], query: { page?: unknown; limit?: unknown }): { items: T[]; meta: PageMeta } {
  const total = rows.length;
  const { page, limit } = parsePageQuery(query);
  if (limit == null) return { items: rows, meta: { page: 1, limit: total, total } };
  const start = (page - 1) * limit;
  return { items: rows.slice(start, start + limit), meta: { page, limit, total } };
}
