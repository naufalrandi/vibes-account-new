import { randomBytes, timingSafeEqual } from "node:crypto";
import { BusinessRecord } from "../../db/models";
import { businessTransitionGraph } from "./prLifecycle";

/**
 * Supplier PO confirmation — the emailed link a supplier opens to acknowledge
 * or decline a purchase order, without an account.
 *
 * OD mints the link token with `poMakeToken` (js/core.js): a 32-bit string hash
 * of `'vibes' + po.id + po.issuedDate`. Both inputs are printed on the purchase
 * order itself, so that value is derivable by anyone holding the PO — fine for
 * a localStorage prototype, not for a public route over a real database, where
 * it would expose every PO's buyer, supplier, line-item pricing and terms and
 * accept forged supplier responses.
 *
 * So the token is the one place this deliberately diverges from OD: it is
 * server-owned and unguessable. A client-supplied `confirmToken` is always
 * discarded (see `applyPoConfirmToken`), the value is minted from
 * `randomBytes` the first time a PO is sent, and it is never regenerated
 * afterwards so a resend does not invalidate a link already in a supplier's
 * inbox. Everything else — the route, payload shape and response semantics —
 * matches OD.
 */

export const PO_AREA = "enterprise";
export const PO_MODULE = "ent-po";

/** 256 bits, URL-safe: the link travels in a query string. */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Enforces server ownership of `data.confirmToken` on every write to an
 * `ent-po` record.
 *
 * - A token already stored is preserved, whatever the client sent. A client
 *   cannot rotate a supplier's live link, nor set one it knows the value of.
 * - A token is minted the first time the PO is actually sent, matching OD's
 *   lazy generation (`poSendDo` — not at issue time).
 * - Until then it stays empty, and an empty token never authenticates a
 *   request (see `verifyPoToken`).
 */
export function applyPoConfirmToken(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  status: string,
): Record<string, unknown> {
  const stored = typeof prev?.confirmToken === "string" ? prev.confirmToken : "";
  if (stored) return { ...next, confirmToken: stored };
  const sent = status === "Sent" || Boolean(next.sentAt);
  return { ...next, confirmToken: sent ? mintToken() : "" };
}

/** Constant-time compare; a blank stored or supplied token never matches. */
export function verifyPoToken(stored: unknown, supplied: string): boolean {
  if (typeof stored !== "string" || !stored || !supplied) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PoConfirmationLineItem {
  desc: string; qty: number; unit: string; price: number; total: number;
}
export interface PoConfirmationView {
  id: string; buyer: string; supplierName: string; supplierEmail: string;
  issuedDate: string; deliveryDate: string; currency: string;
  items: PoConfirmationLineItem[];
  subtotal: number; tax: number; total: number;
  terms: string; notes?: string;
  ack?: { state: "Acknowledged" | "Declined"; at: string; note?: string };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * An `ent-po` record stores a single `amount`, not a line-item table — see
 * `entPoDataSchema`. OD's confirmation sheet still renders a one-row table, so
 * the row is derived from the PO's title and amount, the buyer from the owning
 * operating company, and the terms string from the numeric net-days field.
 * Kept identical to the FE mock's `mockPoConfirmation`, so the screen renders
 * the same against either client.
 */
function toView(r: BusinessRecord): PoConfirmationView {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const amount = num(d.amount) || Number(d.amount) || 0;
  const buyer = r.company === "exelera" ? "PT Exelera Sertifikasi Nusantara" : "PT AXIA Global Indonesia";
  const ackRaw = d.ack as Record<string, unknown> | null | undefined;
  const ack =
    ackRaw && (ackRaw.state === "Acknowledged" || ackRaw.state === "Declined")
      ? { state: ackRaw.state as "Acknowledged" | "Declined", at: str(ackRaw.at), note: str(ackRaw.note) || undefined }
      : undefined;
  const title = r.title;
  return {
    id: r.code,
    buyer,
    supplierName: str(d.supplierName) || title,
    // Not stored on the PO; the supplier is addressed by the emailed link.
    supplierEmail: "",
    issuedDate: str(d.issuedDate) || r.createdAt.toISOString(),
    deliveryDate: str(d.deliveryBy),
    currency: str(d.currency) || "IDR",
    items: [{ desc: title, qty: 1, unit: "Lot", price: amount, total: amount }],
    subtotal: amount,
    tax: 0,
    total: amount,
    terms: `Net ${str(d.terms) || "30"} business days from invoice date`,
    ack,
  };
}

/**
 * Resolves the PO a confirmation link points at. The link carries the PO code,
 * which is only unique per operating company, so the token decides which record
 * is meant — and a token that matches nothing resolves to nothing.
 *
 * Every failure returns the same result to the caller: a public endpoint must
 * not distinguish "no such PO" from "wrong token", or it becomes an oracle for
 * which PO codes exist.
 */
export async function findPoByToken(code: string, token: string): Promise<BusinessRecord | null> {
  if (!code || !token) return null;
  const rows = await BusinessRecord.findAll({ where: { area: PO_AREA, module: PO_MODULE, code } });
  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (d.voided === true) continue;
    if (verifyPoToken(d.confirmToken, token)) return r;
  }
  return null;
}

export async function getPoConfirmation(code: string, token: string): Promise<PoConfirmationView | null> {
  const r = await findPoByToken(code, token);
  return r ? toView(r) : null;
}

export type PoRespondResult =
  | { ok: true; view: PoConfirmationView }
  | { ok: false; reason: "invalid" | "already" };

/**
 * Records the supplier's response. One response only — a PO that already
 * carries an `ack` is not re-answerable, so a leaked link cannot be replayed to
 * flip an acknowledgement into a decline.
 */
export async function respondPoConfirmation(
  code: string,
  token: string,
  state: "Acknowledged" | "Declined",
  note: string,
): Promise<PoRespondResult> {
  const trimmed = note.trim();
  // OD requires a reason to decline; acknowledging carries none.
  if (state === "Declined" && !trimmed) return { ok: false, reason: "invalid" };

  const r = await findPoByToken(code, token);
  if (!r) return { ok: false, reason: "invalid" };
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (d.ack) return { ok: false, reason: "already" };
  // The link stays valid for the life of the PO, so check the PO is still
  // actually awaiting a response: a leaked link must not let a supplier
  // "decline" an order that has since been received or invoiced. Only
  // Sent -> Acknowledged/Declined is legal in the ent-po graph.
  const legal = businessTransitionGraph(PO_AREA, PO_MODULE)?.[r.status] ?? [];
  if (!legal.includes(state)) return { ok: false, reason: "invalid" };

  const at = new Date().toISOString();
  const by = str(d.supplierName) || r.title;
  const activity = Array.isArray(d.activity) ? (d.activity as unknown[]) : [];
  const action = state === "Acknowledged" ? "supplier acknowledged PO" : "supplier declined PO";

  r.status = state;
  r.data = {
    ...d,
    ack: { state, by, at, note: state === "Declined" ? trimmed : "", manual: false },
    activity: [{ ts: at, user: by, action, summary: trimmed || r.code }, ...activity],
  };
  await r.save();
  return { ok: true, view: toView(r) };
}
