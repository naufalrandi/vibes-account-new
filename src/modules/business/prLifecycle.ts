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
  // ("Take action → Re-source supplier", app.html:30861) branching on the
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
 * → Completed hops one-for-one (`poStatusOf`'s status map, app.html:31846). Cancelled is reachable
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

/**
 * Service contract lifecycle (SOF-25, `enterprise/ent-svc-contracts`). OD's contract action bar
 * (modules.js:2660-2662) offers exactly one action per status: Draft → Issue, Issued → Mark
 * signed, and — on Signed — "Convert to project", which creates a *different* record
 * (`ent-projects`) rather than moving this one. So Signed is terminal here.
 */
export const SERVICE_CONTRACT_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Issued"],
  Issued: ["Signed"],
  Signed: [],
};

/**
 * Leave request lifecycle (SOF-25, `enterprise/ent-leave`), a one-for-one port of OD's
 * `leaveActions` (modules.js:3470-3473): only Pending Approval and Needs Revision have any
 * action at all; Approved / Rejected / Cancelled are terminal (`default: return []`). Which
 * role may fire which hop (Manager vs Requester) stays client-side, exactly as `PR_TRANSITIONS`
 * above declines to re-derive the DOA branch rules server-side.
 */
export const LEAVE_TRANSITIONS: Record<string, readonly string[]> = {
  "Pending Approval": ["Approved", "Needs Revision", "Rejected", "Cancelled"],
  "Needs Revision": ["Pending Approval", "Cancelled"],
  Approved: [],
  Rejected: [],
  Cancelled: [],
};

/**
 * Fiscal period open/close (SOF-25, `enterprise/ent-fiscal`). OD's `fiscalPeriodClose`
 * (modules.js:2859) toggles freely in both directions — a closed period can be reopened — so
 * neither state is terminal. Registered anyway so the vocabulary is only these two words, not
 * whatever string a client posts.
 */
export const FISCAL_PERIOD_TRANSITIONS: Record<string, readonly string[]> = {
  Open: ["Closed"],
  Closed: ["Open"],
};

/**
 * Inquiry pipeline (AXI-42, `enterprise/ent-inq`). OD's Sales Pipeline kanban columns
 * (modules.js `inqPipelineStages` ~L1980) in order: Cold Leads → Potential → Qualified →
 * Proposal Sent → Negotiation → Acquired, plus the Lost side-branch reachable from any
 * non-terminal stage (`inqMarkLost`) and reopenable only back to Cold Leads (`inqReopen`).
 * Acquired is terminal — OD converts an Acquired inquiry into a Proposal instead of moving it
 * further (see `ent-proposals` below).
 */
export const INQ_TRANSITIONS: Record<string, readonly string[]> = {
  "Cold Leads": ["Potential", "Lost"],
  Potential: ["Qualified", "Lost"],
  Qualified: ["Proposal Sent", "Lost"],
  "Proposal Sent": ["Negotiation", "Lost"],
  Negotiation: ["Acquired", "Lost"],
  Acquired: [],
  Lost: ["Cold Leads"],
};

/**
 * Proposal lifecycle (AXI-43, `enterprise/ent-proposals`). OD's `propActions` (modules.js
 * ~L2450): Draft can go straight to Sent (non-cert branch) or through Sales Manager review
 * first; Pending SM can bounce back to Draft; Submitted/Sent can both be Rejected; Accepted is
 * terminal (the only next step, "Convert to project", mints a *different* record — see
 * `enterprise/ent-projects` below, mirroring `SERVICE_CONTRACT_TRANSITIONS`'s Signed).
 */
export const PROPOSAL_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Pending SM", "Sent"],
  "Pending SM": ["Submitted", "Draft"],
  // R550 — from Submitted the client decides: Approve, Negotiate or Reject
  // (OD `propClientApprove`/`propNegotiate`/`propClientReject`, modules.js
  // 2520-2526). `Negotiating` was missing entirely, so a negotiated proposal
  // had nowhere to sit and went back through Draft.
  Submitted: ["Accepted", "Negotiating", "Rejected"],
  Negotiating: ["Pending SM"],
  Sent: ["Accepted", "Rejected"],
  Accepted: [],
  Rejected: [],
};

/**
 * Project delivery lifecycle (AXI-44, `enterprise/ent-projects`). A project only ever comes
 * into being already `Planned` (`createProjectFromProposal`, business.service.ts) and then
 * walks a straight line through delivery — OD's `projectActions` (modules.js ~L2530) offers no
 * branch or reopen once Closed.
 */
export const PROJECT_TRANSITIONS: Record<string, readonly string[]> = {
  Planned: ["Active"],
  Active: ["Delivered"],
  Delivered: ["Closed"],
  Closed: [],
};

/** Business Unit modules with a server-enforced transition graph. Extend this map (never
 *  `PR_TRANSITIONS`/`PO_TRANSITIONS` themselves) for another module's own graph. */
export const BUSINESS_TRANSITIONS: Record<string, Record<string, readonly string[]>> = {
  "enterprise/ent-pr": PR_TRANSITIONS,
  "enterprise/ent-po": PO_TRANSITIONS,
  "enterprise/ent-svc-contracts": SERVICE_CONTRACT_TRANSITIONS,
  "enterprise/ent-leave": LEAVE_TRANSITIONS,
  "enterprise/ent-fiscal": FISCAL_PERIOD_TRANSITIONS,
  "enterprise/ent-inq": INQ_TRANSITIONS,
  "enterprise/ent-proposals": PROPOSAL_TRANSITIONS,
  "enterprise/ent-projects": PROJECT_TRANSITIONS,
};

export function businessTransitionGraph(area: string, module: string): Record<string, readonly string[]> | undefined {
  return BUSINESS_TRANSITIONS[`${area}/${module}`];
}

/**
 * Initial status for a graph-gated module: the graph's first key. Every graph above is written
 * with its entry state first (`Draft` for PR and service contracts, `Issued` for PO,
 * `Pending Approval` for leave, `Open` for fiscal periods) — which is also the status OD mints a
 * new record with in each case (`prNew`, `poIssue`, `contractIssue` modules.js:2652, `leaveNew`
 * modules.js:3479, `fiscalGen` modules.js:2856). Without this, `createBusiness`'s generic
 * `"Open"` default dropped a graph-gated record into a status the graph has no key for, and
 * every subsequent transition out of it was rejected as illegal.
 */
export function businessDefaultStatus(area: string, module: string): string | undefined {
  const graph = businessTransitionGraph(area, module);
  return graph ? Object.keys(graph)[0] : undefined;
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
