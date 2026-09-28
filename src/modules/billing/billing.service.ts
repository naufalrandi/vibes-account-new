import { Op, type Transaction, type WhereOptions } from "sequelize";
import { sequelize } from "../../db/sequelize";
import {
  Organization, Subscription, PartnerProfile, TenantProfile,
  Plan, Invoice, Payment, Receipt, RevenueShareStatement, Payout,
} from "../../db/models";
import type { BillingFrequency, PlanStatus } from "../../db/models/billing.models";
import type { PartnerTier } from "../../db/models/partnerProfile.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { maxCodeSeq, withCodeLock } from "../../lib/codeSeq";
import { orgToday } from "../../lib/localDate";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

const n = (v: number | string): number => Number(v); // coerce BIGINT (string) → number

/** Revenue-share base percentage by partner tier (drives partner/SP split). Mirrors the design's PARTNER_TIERS base share. */
const TIER_PCT: Record<PartnerTier, number> = { Bronze: 15, Silver: 20, Gold: 30 };

// --- Plans ---------------------------------------------------------------
export interface PlanInput {
  name: string;
  description?: string | null;
  frequency?: BillingFrequency;
  status?: PlanStatus;
}

function planView(p: Plan) {
  return {
    id: p.id, code: p.code, name: p.name, description: p.description,
    frequency: p.frequency, status: p.status,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

/** Next zero-padded `<PREFIX>-NNNN` code given the existing rows' codes. */
function nextCode(existing: { code: string }[], prefix: string): string {
  let max = 0;
  for (const r of existing) {
    const m = r.code.match(new RegExp(`${prefix}-(\\d+)$`));
    if (m) { const v = Number.parseInt(m[1], 10); if (v > max) max = v; }
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export async function listPlans(): Promise<ReturnType<typeof planView>[]> {
  const rows = await Plan.findAll({ order: [["createdAt", "ASC"]] });
  return rows.map(planView);
}

export async function createPlan(auth: AuthContext, input: PlanInput, ip: string | null) {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages plans");
  const plan = await sequelize.transaction(async (tx) => Plan.create({
    code: await lockedCode(Plan, "PLN", tx),
    name: input.name, description: input.description ?? null,
    // OD `planModal` (js/core.js:21765) pre-selects "Draft" for a new plan.
    frequency: input.frequency ?? "Monthly", status: input.status ?? "Draft",
  }, { transaction: tx }));
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "billing.plan.created", entityType: "Plan", entityId: plan.id, sourceIp: ip, result: "Success" });
  return planView(plan);
}

export async function updatePlan(auth: AuthContext, id: string, input: Partial<PlanInput>, ip: string | null) {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages plans");
  const plan = await Plan.findByPk(id);
  if (!plan) throw new NotFoundError("Plan does not exist", "PLAN_NOT_FOUND");
  if (input.name !== undefined) plan.name = input.name;
  if (input.description !== undefined) plan.description = input.description ?? null;
  if (input.frequency !== undefined) plan.frequency = input.frequency;
  if (input.status !== undefined) plan.status = input.status;
  await plan.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "billing.plan.updated", entityType: "Plan", entityId: plan.id, sourceIp: ip, result: "Success" });
  return planView(plan);
}

// --- Scope helpers -------------------------------------------------------
/** Tenant org ids whose invoices/payments/receipts the actor may see (null = all). */
const tenantScopeIds = (auth: AuthContext) => visibleTenantOrgIds(auth);

/** Partner (Distributor) org ids whose revenue-share/payouts the actor may see (null = all). */
function partnerScopeIds(auth: AuthContext): string[] | null {
  if (auth.orgType === "ServiceOwner") return null;
  if (auth.orgType === "Distributor") return [auth.orgId];
  return []; // Tenants have no revenue-share visibility
}

async function orgNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const orgs = await Organization.findAll({ where: { id: [...new Set(ids)] }, attributes: ["id", "name"] });
  return new Map(orgs.map((o) => [o.id, o.name]));
}

// --- Subscriptions (derived from the subscriptions table) ----------------
export async function listSubscriptions(auth: AuthContext) {
  const where: WhereOptions = {};
  const ids = await tenantScopeIds(auth);
  if (ids !== null) Object.assign(where, { orgId: { [Op.in]: ids } });
  const subs = await Subscription.findAll({ where });
  const names = await orgNames(subs.map((s) => s.orgId));
  const planByName = new Map((await Plan.findAll()).map((p) => [p.name.toLowerCase(), p]));
  return subs.map((s) => {
    const plan = planByName.get(s.plan.toLowerCase());
    const fmt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
    return {
      id: s.id, tenant: names.get(s.orgId) ?? "—", plan: plan?.name ?? s.plan,
      frequency: plan?.frequency ?? "Monthly",
      term: `${fmt(s.startDate)} → ${fmt(s.endDate)}`, status: s.status,
    };
  });
}

// --- Invoices / Payments / Receipts --------------------------------------
async function invoiceView(inv: Invoice, name: string) {
  return {
    id: inv.id, number: inv.number, tenant: name, tenantId: inv.orgId,
    period: inv.period, start: inv.periodStart, end: inv.periodEnd,
    amount: n(inv.amount), currency: inv.currency, status: inv.status,
    paidDate: inv.paidDate, dueDate: inv.dueDate,
  };
}

/**
 * `tenantId` narrows to one tenant org's invoices within the caller's scope; it
 * never widens it — a tenant outside the caller's visibility yields an empty list.
 */
export async function listInvoices(auth: AuthContext, filters: { tenantId?: string } = {}) {
  const where: WhereOptions = {};
  const ids = await tenantScopeIds(auth);
  if (filters.tenantId) {
    if (ids !== null && !ids.includes(filters.tenantId)) return [];
    Object.assign(where, { orgId: filters.tenantId });
  } else if (ids !== null) Object.assign(where, { orgId: { [Op.in]: ids } });
  const rows = await Invoice.findAll({ where, order: [["createdAt", "DESC"]] });
  const names = await orgNames(rows.map((r) => r.orgId));
  return Promise.all(rows.map((r) => invoiceView(r, names.get(r.orgId) ?? "—")));
}

export async function listPayments(auth: AuthContext) {
  const where: WhereOptions = {};
  const ids = await tenantScopeIds(auth);
  if (ids !== null) Object.assign(where, { orgId: { [Op.in]: ids } });
  const rows = await Payment.findAll({ where, include: [{ model: Invoice, attributes: ["number"] }], order: [["createdAt", "DESC"]] });
  const names = await orgNames(rows.map((r) => r.orgId));
  return rows.map((p) => ({
    id: p.code, invoice: (p.get("Invoice") as Invoice | undefined)?.number ?? "—",
    tenant: names.get(p.orgId) ?? "—", date: p.date, amount: n(p.amount),
    method: p.method, ref: p.ref ?? "", status: p.status,
  }));
}

export async function listReceipts(auth: AuthContext) {
  const where: WhereOptions = {};
  const ids = await tenantScopeIds(auth);
  if (ids !== null) Object.assign(where, { orgId: { [Op.in]: ids } });
  const rows = await Receipt.findAll({
    where,
    include: [{ model: Invoice, attributes: ["number"] }, { model: Payment, attributes: ["code"] }],
    order: [["createdAt", "DESC"]],
  });
  const names = await orgNames(rows.map((r) => r.orgId));
  return rows.map((r) => ({
    id: r.code, invoice: (r.get("Invoice") as Invoice | undefined)?.number ?? "—",
    payment: (r.get("Payment") as Payment | undefined)?.code ?? "—",
    tenant: names.get(r.orgId) ?? "—", date: r.date, amount: n(r.amount), status: r.status,
  }));
}

const PAY_METHODS = new Set([
  "Bank Transfer", "Virtual Account", "QRIS", "Credit Card",
  "Digital Wallet · GoPay", "Digital Wallet · OVO",
]);

export interface PayInvoiceInput {
  reference: string;
  method?: string;
  note?: string;
}

/** Locked `<PREFIX>-NNNN` for rows inserted inside `tx`. */
async function lockedCode(model: typeof Plan | typeof Payment | typeof Receipt, prefix: string, tx: Transaction): Promise<string> {
  return withCodeLock(prefix, tx, async () => `${prefix}-${String((await maxCodeSeq(model, prefix, tx)) + 1).padStart(4, "0")}`);
}

/**
 * Record an offline payment against an unpaid invoice (Service Owner only):
 * records a Payment, issues a Receipt, marks the invoice Paid. The invoice row
 * is locked and its status re-checked inside the transaction so two concurrent
 * calls can't both pay it.
 */
export async function payInvoice(auth: AuthContext, invoiceId: string, input: PayInvoiceInput, ip: string | null) {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner records invoice payments");
  const method = input.method ?? "Bank Transfer";
  if (!PAY_METHODS.has(method)) throw new BadRequestError("Unsupported payment method", "BAD_METHOD");

  const today = await orgToday(auth.orgId);
  const inv = await sequelize.transaction(async (tx) => {
    const inv = await Invoice.findByPk(invoiceId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!inv) throw new NotFoundError("Invoice does not exist", "INVOICE_NOT_FOUND");
    if (inv.status === "Paid") throw new ConflictError("Invoice is already paid", "ALREADY_PAID");
    if (inv.status === "Draft") throw new ConflictError("Draft invoices cannot be paid", "INVOICE_DRAFT");
    const payment = await Payment.create({
      code: await lockedCode(Payment, "PAY", tx),
      invoiceId: inv.id, orgId: inv.orgId, date: today,
      amount: inv.amount, method, ref: input.reference, status: "Verified",
    }, { transaction: tx });
    await Receipt.create({
      code: await lockedCode(Receipt, "RCP", tx),
      invoiceId: inv.id, paymentId: payment.id, orgId: inv.orgId,
      date: today, amount: inv.amount, status: "Issued",
    }, { transaction: tx });
    inv.status = "Paid";
    inv.paidDate = today;
    await inv.save({ transaction: tx });
    await writeAudit({ actorUserId: auth.userId, organizationId: inv.orgId, action: "billing.invoice.paid", entityType: "Invoice", entityId: inv.id, sourceIp: ip, result: "Success", metadata: { method, reference: input.reference, note: input.note ?? null, paymentId: payment.id } }, tx);
    return inv;
  });
  const org = await Organization.findByPk(inv.orgId);
  return invoiceView(inv, org?.name ?? "—");
}

// --- Revenue share / Payouts ---------------------------------------------
/** Compute the partner/SP split for a tier and total revenue (pure money math). */
export function computeShare(tier: PartnerTier, totalRev: number): { pct: number; partnerShare: number; axiaShare: number } {
  const pct = TIER_PCT[tier];
  const partnerShare = Math.round((totalRev * pct) / 100);
  return { pct, partnerShare, axiaShare: totalRev - partnerShare };
}

/** `partnerId` narrows to one partner org's statements within the caller's scope (never widens it). */
export async function listRevenueShare(auth: AuthContext, filters: { partnerId?: string } = {}) {
  const ids = partnerScopeIds(auth);
  if (ids !== null && ids.length === 0) return [];
  if (filters.partnerId && ids !== null && !ids.includes(filters.partnerId)) return [];
  const where: WhereOptions = {};
  if (filters.partnerId) Object.assign(where, { partnerOrgId: filters.partnerId });
  else if (ids !== null) Object.assign(where, { partnerOrgId: { [Op.in]: ids } });
  const rows = await RevenueShareStatement.findAll({ where, order: [["createdAt", "DESC"]] });
  const names = await orgNames(rows.map((r) => r.partnerOrgId));
  return rows.map((r) => ({
    id: r.code, partnerId: r.partnerOrgId, partner: names.get(r.partnerOrgId) ?? "—",
    period: r.period, totalRev: n(r.totalRev), pct: r.pct,
    partnerShare: n(r.partnerShare), axiaShare: n(r.axiaShare), status: r.status,
  }));
}

export async function listPayouts(auth: AuthContext) {
  const ids = partnerScopeIds(auth);
  if (ids !== null && ids.length === 0) return [];
  const where: WhereOptions = {};
  if (ids !== null) Object.assign(where, { partnerOrgId: { [Op.in]: ids } });
  const rows = await Payout.findAll({ where, include: [{ model: RevenueShareStatement, attributes: ["code"] }], order: [["createdAt", "DESC"]] });
  const names = await orgNames(rows.map((r) => r.partnerOrgId));
  return rows.map((p) => ({
    id: p.code, partnerId: p.partnerOrgId, partner: names.get(p.partnerOrgId) ?? "—",
    statement: (p.get("RevenueShareStatement") as RevenueShareStatement | undefined)?.code ?? "—",
    period: p.period, amount: n(p.amount), date: p.date, status: p.status,
  }));
}

export async function markPayoutPaid(auth: AuthContext, id: string, ip: string | null) {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner settles payouts");
  const po = await Payout.findOne({ where: { code: id } }) ?? (await Payout.findByPk(id));
  if (!po) throw new NotFoundError("Payout does not exist", "PAYOUT_NOT_FOUND");
  if (po.status === "Paid") throw new ConflictError("Payout already paid", "ALREADY_PAID");
  po.status = "Paid";
  po.date = await orgToday(auth.orgId);
  await po.save();
  // Settling the payout also marks its statement Paid.
  if (po.statementId) {
    const stmt = await RevenueShareStatement.findByPk(po.statementId);
    if (stmt && stmt.status !== "Paid") { stmt.status = "Paid"; await stmt.save(); }
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "billing.payout.paid", entityType: "Payout", entityId: po.id, sourceIp: ip, result: "Success" });
  const names = await orgNames([po.partnerOrgId]);
  return {
    id: po.code, partnerId: po.partnerOrgId, partner: names.get(po.partnerOrgId) ?? "—",
    statement: po.statementId ?? "—", period: po.period, amount: n(po.amount), date: po.date, status: po.status,
  };
}

// --- Dashboard -----------------------------------------------------------
export async function getDashboard(auth: AuthContext) {
  const tIds = await tenantScopeIds(auth);
  const invWhere: WhereOptions = {};
  if (tIds !== null) Object.assign(invWhere, { orgId: { [Op.in]: tIds } });
  const invoices = await Invoice.findAll({ where: invWhere });

  const subWhere: WhereOptions = {};
  if (tIds !== null) Object.assign(subWhere, { orgId: { [Op.in]: tIds } });
  const activeSubscriptions = await Subscription.count({ where: { ...subWhere, status: "Active" } });

  const pIds = partnerScopeIds(auth);
  const rsWhere: WhereOptions = {};
  if (pIds !== null) Object.assign(rsWhere, { partnerOrgId: { [Op.in]: pIds.length ? pIds : ["__none__"] } });
  const statements = await RevenueShareStatement.findAll({ where: rsWhere });
  const poWhere: WhereOptions = {};
  if (pIds !== null) Object.assign(poWhere, { partnerOrgId: { [Op.in]: pIds.length ? pIds : ["__none__"] } });
  const payouts = await Payout.findAll({ where: poWhere });

  const today = await orgToday(auth.orgId);
  const sum = (rows: Invoice[]) => rows.reduce((a, i) => a + n(i.amount), 0);
  const paid = invoices.filter((i) => i.status === "Paid");
  const unpaid = invoices.filter((i) => i.status === "Unpaid");
  const overdue = unpaid.filter((i) => i.dueDate && i.dueDate < today);

  const months = ["January", "February", "March", "April", "May", "June"];
  return {
    totalRevenue: sum(invoices),
    paidRevenue: sum(paid),
    outstanding: sum(unpaid),
    activeSubscriptions,
    overdueInvoices: overdue.length,
    draftInvoices: invoices.filter((i) => i.status === "Draft").length,
    partnerShareLiability: statements.filter((s) => s.status !== "Paid").reduce((a, s) => a + n(s.partnerShare), 0),
    upcomingPayouts: payouts.filter((p) => p.status === "Pending").reduce((a, p) => a + n(p.amount), 0),
    monthlyPaid: months.map((month) => ({
      month,
      amount: paid.filter((i) => i.period.startsWith(month)).reduce((a, i) => a + n(i.amount), 0),
    })),
    recentInvoices: await Promise.all(
      [...invoices].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6).map(async (i) => {
        const org = await Organization.findByPk(i.orgId);
        return invoiceView(i, org?.name ?? "—");
      }),
    ),
  };
}

// --- Revenue-share generation (used by the seeder + tests) ---------------
/**
 * Generate (or refresh) a partner's revenue-share statement for a period from
 * its tenants' paid invoices, plus a pending payout. Pure of HTTP; reused by the
 * seeder to produce realistic, internally-consistent sample data.
 */
export async function generateStatementForPartner(partnerOrgId: string, period: string): Promise<RevenueShareStatement | null> {
  const partnerProfile = await PartnerProfile.findOne({ where: { orgId: partnerOrgId } });
  const tier = partnerProfile?.tier;
  if (!tier) return null;
  const tenants = await TenantProfile.findAll({ where: { partnerOrgId } });
  const tenantOrgIds = tenants.map((t) => t.orgId);
  if (tenantOrgIds.length === 0) return null;
  const invoices = await Invoice.findAll({ where: { orgId: { [Op.in]: tenantOrgIds }, status: "Paid", period } });
  const totalRev = invoices.reduce((a, i) => a + n(i.amount), 0);
  const { pct, partnerShare, axiaShare } = computeShare(tier, totalRev);
  const stmt = await RevenueShareStatement.create({
    code: nextCode(await RevenueShareStatement.findAll({ attributes: ["code"] }), "RSS"), partnerOrgId, period,
    totalRev, pct, partnerShare, axiaShare, status: "Approved",
  });
  await Payout.create({
    code: nextCode(await Payout.findAll({ attributes: ["code"] }), "PO"), partnerOrgId, statementId: stmt.id, period,
    amount: partnerShare, date: null, status: "Pending",
  });
  return stmt;
}
