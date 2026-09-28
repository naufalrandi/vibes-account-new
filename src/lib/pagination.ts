import { z } from "zod";

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

// --- Offset pagination (`?limit=&offset=`) ----------------------------------

/** Hard ceiling on an explicit `?limit=`. */
export const MAX_OFFSET_LIMIT = 500;
/** Rows returned when the caller passes no `?limit=` — keeps unbounded lists bounded. */
export const DEFAULT_LIST_CAP = 1000;

export interface OffsetPage {
  limit: number;
  offset: number;
}

export interface OffsetPageMeta extends PageMeta {
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

/**
 * Parse optional `limit` (1..500) / `offset` (≥0) query params. Absent limit →
 * DEFAULT_LIST_CAP. Malformed or out-of-range values are a 400 (via ZodError).
 */
export function parseOffsetPage(query: { limit?: unknown; offset?: unknown }): OffsetPage {
  const q = offsetPageSchema.parse({ limit: query.limit, offset: query.offset });
  return { limit: q.limit ?? DEFAULT_LIST_CAP, offset: q.offset ?? 0 };
}

const intParam = (max?: number) => {
  let n = z.coerce.number().int().min(0);
  if (max !== undefined) n = n.min(1).max(max);
  return z.preprocess((v) => (v === "" || v === undefined ? undefined : v), n.optional());
};
const offsetPageSchema = z.object({ limit: intParam(MAX_OFFSET_LIMIT), offset: intParam() });

/** `meta` for an offset page: legacy `page/limit/total` plus `pagination`. */
export function offsetPageMeta(total: number, { limit, offset }: OffsetPage): OffsetPageMeta {
  return {
    page: Math.floor(offset / limit) + 1,
    limit,
    total,
    pagination: { limit, offset, total, hasMore: offset + limit < total },
  };
}
