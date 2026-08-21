/**
 * Purchase Request lifecycle rules (OD `prActions`, app.html:30780-30810), server-side.
 *
 * `business.service.ts` has no per-module "deep" transition-graph concept the
 * way `src/modules/implementation/registry.ts` does for the ISO clause
 * registers (`RegisterModule.deep`/`transitions`, enforced in
 * `implementation.service.ts`'s `updateRecord` via `assertReviewTransition`).
 * Rather than generalizing that whole abstraction onto `business_records` for
 * a single consumer, `BUSINESS_TRANSITIONS` below is the minimal analogous
 * shape scoped to the handful of Business Unit modules that actually need
 * server-enforced transitions — keyed by `${area}/${module}` (the same key
 * shape `lib/platform/registers.ts` uses on the FE), so a sibling module
 * (Purchase Orders, `enterprise/ent-po`, D-2) can add its own entry here
 * without touching this file's `assertBusinessTransition` helper.
 *
 * `PR_TRANSITIONS` is a **topology** graph — every status a request can ever
 * reach from a given status across *any* of `prActions`' DOA/intake-review/
 * PO-acknowledgement branches (see `lib/procurement/purchaseRequests.ts` on
 * the FE for the exact branch-by-branch derivation). It deliberately does
 * NOT re-implement which role or DOA band gets to fire which specific
 * transition — that stays a client-side (and, once role-scoped actions ship,
 * an IAM-action-scoped) concern. This is the same division of labor
 * `assertReviewTransition` draws for Management Reviews: reject illegal
 * jumps, don't re-derive the whole business-rule engine server-side.
 */
import { BadRequestError } from "../../lib/errors";

export const PR_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Pending LM Review", "Cancelled"],
  "Needs Revision": ["Pending LM Review", "Cancelled"],
  "Pending LM Review": ["In Procurement", "Needs Revision", "Rejected"],
  // `In Procurement` → `Completed` covers `prIntakeReview`'s "fulfil from
  // stock" outcome (app.html:31672) — the request never leaves this status
  // through Sourcing/Budget/Approval at all in that branch.
  "In Procurement": ["Sourcing & Quotation", "Budget Review", "Approved", "Completed", "Needs Revision", "Rejected"],
  "Sourcing & Quotation": ["Budget Review", "Approved"],
  "Budget Review": ["Approved", "No Budget Available", "Needs Revision", "Rejected"],
  "No Budget Available": ["Budget Review", "Cancelled"],
  Approved: ["PO Issued"],
  // `PO Issued` → `Sourcing & Quotation` / `In Procurement` covers `prResource`
  // ("Take action → Re-source supplier", app.html:30873) branching on the
  // category's sourcing method.
  "PO Issued": ["Receiving", "Sourcing & Quotation", "In Procurement", "Cancelled"],
  Receiving: ["QC / Acceptance"],
  "QC / Acceptance": ["Invoice & Payment", "Receiving", "Rejected — returned"],
  "Invoice & Payment": ["Completed"],
  Completed: [],
  Rejected: [],
  "Rejected — returned": [],
  Cancelled: [],
};

/**
 * Purchase Order lifecycle (D-2 sibling of `PR_TRANSITIONS` above). Vocabulary and topology
 * derived from OD's `poStatusChip`/`poStatusOf` (app.html:31846-31855) and the actions that
 * actually drive a PO between those states — `poSend`/`poSendDo` (app.html:31870-31883),
 * `poConfirmAccept`/`poConfirmDecline` (app.html:31922-31934), `prAckManual` (app.html:30849-
 * 30854), `prResource`/`prCancelPO` (app.html:30861-30879). See `lib/procurement/purchaseOrders.ts`
 * on the FE for the full derivation, including why this port persists `status` directly on the
 * `ent-po` record rather than OD's live per-render derivation from the linked PR's own status.
 *
 * Issued → Sent is the first send (`poSendDo`, unconditional on `po.sentAt`). Sent branches to
 * Acknowledged or Declined via the supplier's response (`/po-confirm/[id]`, or `prAckManual`'s
 * manual equivalent); Declined loops back to Sent on resend (`poSendDo` clears a Declined `ack`
 * so the supplier gets "a fresh response window", app.html:31880). Acknowledged → Confirmed is
 * the PR's own acknowledgement handling moving its linked request into Receiving. Confirmed →
 * Received → Invoiced → Completed mirrors the PR's Receiving → QC/Acceptance → Invoice & Payment
 * → Completed hops one-for-one (`poStatusOf`'s status map, app.html:31853). Cancelled is reachable
 * only from Issued/Sent/Acknowledged/Declined — OD only ever offers Take Action → Re-source/Cancel
 * (`prActionsFor`'s `"PO Issued"` case) while the linked PR is still status `'PO Issued'`, i.e.
 * before acknowledgement moves it into Receiving; once a PO is Confirmed there is no OD affordance
 * to cancel it, so this graph does not allow that jump either.
 */
export const PO_TRANSITIONS: Record<string, readonly string[]> = {
  Issued: ["Sent", "Cancelled"],
  Sent: ["Acknowledged", "Declined", "Cancelled"],
  Declined: ["Sent", "Cancelled"],
  Acknowledged: ["Confirmed", "Cancelled"],
  Confirmed: ["Received"],
  Received: ["Invoiced"],
  Invoiced: ["Completed"],
  Completed: [],
  Cancelled: [],
};

/** Business Unit modules with a server-enforced transition graph. Extend this map (never
 *  `PR_TRANSITIONS`/`PO_TRANSITIONS` themselves) for another module's own graph. */
export const BUSINESS_TRANSITIONS: Record<string, Record<string, readonly string[]>> = {
  "enterprise/ent-pr": PR_TRANSITIONS,
  "enterprise/ent-po": PO_TRANSITIONS,
};

export function businessTransitionGraph(area: string, module: string): Record<string, readonly string[]> | undefined {
  return BUSINESS_TRANSITIONS[`${area}/${module}`];
}

/** Mirrors `implementation/reviewLifecycle.ts`'s `assertReviewTransition` shape exactly. */
export function assertBusinessTransition(area: string, module: string, from: string, to: string): void {
  if (from === to) return;
  const graph = businessTransitionGraph(area, module);
  if (!graph) return; // module has no enforced graph — any status is accepted (today's behavior for every other business module).
  const legal = graph[from] ?? [];
  if (!legal.includes(to)) {
    throw new BadRequestError(`A ${module} record cannot move from "${from}" to "${to}"`, "INVALID_TRANSITION");
  }
}
