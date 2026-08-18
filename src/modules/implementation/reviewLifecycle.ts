/**
 * Management Review lifecycle rules (OD index.html:10985–11190), server-side.
 *
 * The registry declares `deep: true` + a transition graph for `reviews`; this
 * module holds the review-specific validation and side effects that go with
 * it: the Draft/Scheduled creation gate, the date+time schedule requirement
 * (`mrSave` 11124–11126), the Finalize stamps (`mrFinalize` 10996), the
 * mandatory cancellation reason (`mrCancel` 10997), and the global per-org
 * `MRI-####` agenda-topic sequence (OD's monotonic `db._mriN`, 11134).
 */
import { ImplementationRecord } from "../../db/models";
import { BadRequestError } from "../../lib/errors";
import { MS_MODULES } from "./registry";

const MRI_RE = /^MRI-(\d{4,})$/;

/** OD `mrSave`: a review is created as a Draft or scheduled directly. */
export function assertReviewCreateStatus(status: string): void {
  const allowed = MS_MODULES.reviews.createStatuses ?? [];
  if (!allowed.includes(status)) {
    throw new BadRequestError(
      `A management review starts as ${allowed.map((s) => `"${s}"`).join(" or ")} — "${status}" is a lifecycle transition`,
      "INVALID_CREATE_STATUS",
    );
  }
}

/** OD `mrSave` (11124–11126): a review cannot be saved without a date and time. */
export function assertReviewSchedule(data: Record<string, unknown>): void {
  if (!String(data.date ?? "").trim()) throw new BadRequestError("Scheduled date is required", "DATE_REQUIRED");
  if (!String(data.time ?? "").trim()) throw new BadRequestError("Scheduled time is required", "TIME_REQUIRED");
}

export function assertReviewTransition(from: string, to: string): void {
  if (from === to) return;
  const legal = MS_MODULES.reviews.transitions?.[from] ?? [];
  if (!legal.includes(to)) {
    throw new BadRequestError(
      `A management review cannot move from "${from}" to "${to}"`,
      "INVALID_TRANSITION",
    );
  }
}

/**
 * Data stamps carried by a lifecycle transition:
 * - Finalized stamps finalizedBy/finalizedDate (OD `mrFinalize` — the fields
 *   MrData always declared but nothing ever wrote).
 * - Cancelled demands a typed reason (OD `mrCancel`) and stamps who/when.
 */
export function reviewTransitionStamp(
  to: string,
  provided: Record<string, unknown>,
  existing: Record<string, unknown>,
  who: string,
  nowIso: string,
): Record<string, unknown> | undefined {
  if (to === "Finalized") {
    return { finalizedBy: who, finalizedDate: nowIso };
  }
  if (to === "Cancelled") {
    const reason = String(provided.cancelReason ?? existing.cancelReason ?? "").trim();
    if (!reason) {
      throw new BadRequestError("A cancellation reason is required", "CANCEL_REASON_REQUIRED");
    }
    return { cancelReason: reason, cancelledBy: who, cancelledAt: nowIso };
  }
  return undefined;
}

/** Highest `MRI-####` number found across the given reviews' `data.topics`. */
export function mriMax(datas: Array<Record<string, unknown> | null | undefined>): number {
  let max = 0;
  for (const d of datas) {
    const topics = Array.isArray(d?.topics) ? (d?.topics as Array<Record<string, unknown>>) : [];
    for (const t of topics) {
      const m = typeof t?.id === "string" ? MRI_RE.exec(t.id) : null;
      if (m) {
        const n = Number.parseInt(m[1] as string, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
  }
  return max;
}

/** True when at least one topic still needs a real `MRI-####` id. */
export function topicsNeedIds(data: Record<string, unknown>): boolean {
  if (!Array.isArray(data.topics)) return false;
  return (data.topics as Array<Record<string, unknown>>).some(
    (t) => !(typeof t.id === "string" && MRI_RE.test(t.id)),
  );
}

/** Assign `MRI-####` ids to unnumbered topics, counting up from `startAfter`. */
export function withTopicIds(data: Record<string, unknown>, startAfter: number): Record<string, unknown> {
  if (!Array.isArray(data.topics)) return data;
  let n = startAfter;
  const topics = (data.topics as Array<Record<string, unknown>>).map((t) => {
    if (typeof t.id === "string" && MRI_RE.test(t.id)) return t;
    n += 1;
    return { ...t, id: `MRI-${String(n).padStart(4, "0")}` };
  });
  return { ...data, topics };
}

/**
 * The global per-org MRI sequence: OD keeps one tenant-wide counter
 * (`db._mriN`) so topic ids never collide across reviews. Server-side this is
 * org-scoped max+1 across every review record's topics — including the ids
 * already present in the incoming payload.
 */
export async function assignReviewTopicIds(
  orgId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!topicsNeedIds(data)) return data;
  const rows = await ImplementationRecord.findAll({
    where: { module: "reviews", orgId },
    attributes: ["data"],
  });
  const start = mriMax([...rows.map((r) => r.data ?? {}), data]);
  return withTopicIds(data, start);
}
