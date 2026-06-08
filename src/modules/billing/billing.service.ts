import { Organization, Invoice, PartnerAgreement } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { assertServiceOwner } from "./plan.service";

const PAY_METHODS = ["Bank Transfer", "Virtual Account", "QRIS", "Credit Card", "Digital Wallet · GoPay", "Digital Wallet · OVO"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface InvoiceView {
  id: string; number: string; tenant: string; tenantId: string; period: string; start: string; end: string;
  amount: number; currency: string; status: string; paidDate: string | null; dueDate: string | null;
}
export interface PaymentView { id: string; invoice: string; tenant: string; date: string; amount: number; method: string; ref: string; status: string; }
export interface ReceiptView { id: string; invoice: string; payment: string; tenant: string; date: string; amount: number; status: string; }
export interface SubscriptionView { id: string; tenant: string; plan: string; frequency: string; term: string; status: string; }
export interface RevenueShareView { id: string; partnerId: string; partner: string; period: string; totalRev: number; pct: number; partnerShare: number; axiaShare: number; status: string; }
export interface PayoutView { id: string; partnerId: string; partner: string; statement: string; period: string; amount: number; date: string | null; status: string; }
export interface BillingDashboard {
  totalRevenue: number; paidRevenue: number; outstanding: number; activeSubscriptions: number;
  overdueInvoices: number; draftInvoices: number; partnerShareLiability: number; upcomingPayouts: number;
  monthlyPaid: { month: string; amount: number }[]; recentInvoices: InvoiceView[];
}

/** Load the org map + tenant→partner revenue-share once for the derivations. */
async function context(auth: AuthContext) {
  assertServiceOwner(auth);
  const orgs = await Organization.findAll();
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const agreements = await PartnerAgreement.findAll({ attributes: ["orgId", "vars"] });
  const pctByPartner = new Map<string, number>();
  for (const a of agreements) {
    const rev = parseInt((a.vars?.revenueShare as string) ?? "20", 10);
    pctByPartner.set(a.orgId, Number.isNaN(rev) ? 20 : rev);
  }
  const invoices = await Invoice.findAll({ order: [["start", "ASC"], ["number", "ASC"]] });
  return { orgById, pctByPartner, invoices };
}

function invoiceView(inv: Invoice, tenant: string): InvoiceView {
  return {
    id: inv.id, number: inv.number, tenant, tenantId: inv.orgId, period: inv.period, start: inv.start, end: inv.end,
    amount: inv.amount, currency: inv.currency, status: inv.status, paidDate: inv.paidDate, dueDate: inv.dueDate,
  };
}

export async function listInvoices(auth: AuthContext): Promise<InvoiceView[]> {
  const { orgById, invoices } = await context(auth);
  return invoices.map((i) => invoiceView(i, orgById.get(i.orgId)?.name ?? "—"));
}

export async function listPayments(auth: AuthContext): Promise<PaymentView[]> {
  const { orgById, invoices } = await context(auth);
  return invoices
    .filter((i) => i.status === "Paid")
    .map((i, idx) => ({
      id: `PAY-${String(idx + 1).padStart(4, "0")}`,
      invoice: i.number, tenant: orgById.get(i.orgId)?.name ?? "—", date: i.paidDate ?? "—",
      amount: i.amount, method: PAY_METHODS[idx % PAY_METHODS.length], ref: `REF-${100000 + idx}`, status: "Verified",
    }));
}

export async function listReceipts(auth: AuthContext): Promise<ReceiptView[]> {
  const payments = await listPayments(auth);
  return payments.map((p, idx) => ({
    id: `RCP-2026-${String(idx + 1).padStart(4, "0")}`,
    invoice: p.invoice, payment: p.id, tenant: p.tenant, date: p.date, amount: p.amount, status: "Issued",
  }));
}

export async function listSubscriptions(auth: AuthContext): Promise<SubscriptionView[]> {
  const { orgById } = await context(auth);
  const PLAN_ROTATION = ["Starter", "Professional", "Enterprise"];
  const STATUS_MAP: Record<string, string> = { Active: "Active", Suspended: "Suspended", PendingApproval: "Pending Activation", Inactive: "Cancelled", Draft: "Draft" };
  const tenants = [...orgById.values()].filter((o) => o.type === "Tenant");
  return tenants.map((t, idx) => ({
    id: `SUB-${String(idx + 1).padStart(4, "0")}`,
    tenant: t.name, plan: PLAN_ROTATION[idx % PLAN_ROTATION.length], frequency: idx % 2 === 0 ? "Annual" : "Monthly",
    term: `${new Date().getUTCFullYear()}-01-01 → ${new Date().getUTCFullYear() + 1}-01-01`,
    status: STATUS_MAP[t.status] ?? "Draft",
  }));
}

/** Revenue-share statements: partner-acquired tenant invoices grouped by period × agreement rate. */
export async function listRevenueShare(auth: AuthContext): Promise<RevenueShareView[]> {
  const { orgById, pctByPartner, invoices } = await context(auth);
  const groups = new Map<string, { partnerId: string; period: string; totalRev: number; allPaid: boolean }>();
  for (const inv of invoices) {
    const tenant = orgById.get(inv.orgId);
    const parent = tenant?.parentOrgId ? orgById.get(tenant.parentOrgId) : undefined;
    if (!parent || parent.type !== "Distributor") continue; // only partner-acquired tenants
    if (inv.status === "Draft") continue;
    const key = `${parent.id}|${inv.period}`;
    const g = groups.get(key) ?? { partnerId: parent.id, period: inv.period, totalRev: 0, allPaid: true };
    g.totalRev += inv.amount;
    if (inv.status !== "Paid") g.allPaid = false;
    groups.set(key, g);
  }
  let seq = 0;
  return [...groups.values()].map((g) => {
    seq += 1;
    const pct = pctByPartner.get(g.partnerId) ?? 20;
    const partnerShare = Math.round((g.totalRev * pct) / 100);
    return {
      id: `RSS-${String(seq).padStart(4, "0")}`,
      partnerId: g.partnerId, partner: orgById.get(g.partnerId)?.name ?? "—", period: g.period,
      totalRev: g.totalRev, pct, partnerShare, axiaShare: g.totalRev - partnerShare,
      status: g.allPaid ? "Paid" : "Approved",
    };
  });
}

export async function listPayouts(auth: AuthContext): Promise<PayoutView[]> {
  const statements = await listRevenueShare(auth);
  return statements.map((s, idx) => {
    const monthIdx = MONTHS.findIndex((m) => s.period.startsWith(m));
    const nextMonth = monthIdx >= 0 ? MONTHS[(monthIdx + 1) % 12] : "—";
    const paid = s.status === "Paid";
    return {
      id: `PO-${String(idx + 1).padStart(4, "0")}`,
      partnerId: s.partnerId, partner: s.partner, statement: s.id, period: s.period, amount: s.partnerShare,
      date: paid && monthIdx >= 0 ? `2026 ${nextMonth} 15` : null, status: paid ? "Paid" : "Pending",
    };
  });
}

export async function getDashboard(auth: AuthContext): Promise<BillingDashboard> {
  const { orgById, invoices } = await context(auth);
  const sum = (pred: (i: Invoice) => boolean) => invoices.filter(pred).reduce((a, i) => a + i.amount, 0);
  const statements = await listRevenueShare(auth);
  const payouts = await listPayouts(auth);
  const monthlyPaid = MONTHS.slice(0, 6).map((month) => ({
    month,
    amount: invoices.filter((i) => i.status === "Paid" && i.period.startsWith(month)).reduce((a, i) => a + i.amount, 0),
  }));
  const recent = [...invoices].slice(-6).reverse().map((i) => invoiceView(i, orgById.get(i.orgId)?.name ?? "—"));
  return {
    totalRevenue: sum(() => true),
    paidRevenue: sum((i) => i.status === "Paid"),
    outstanding: sum((i) => i.status === "Unpaid"),
    activeSubscriptions: [...orgById.values()].filter((o) => o.type === "Tenant" && o.status === "Active").length,
    overdueInvoices: invoices.filter((i) => i.status === "Unpaid").length,
    draftInvoices: invoices.filter((i) => i.status === "Draft").length,
    partnerShareLiability: statements.filter((s) => s.status !== "Paid").reduce((a, s) => a + s.partnerShare, 0),
    upcomingPayouts: payouts.filter((p) => p.status === "Pending").reduce((a, p) => a + p.amount, 0),
    monthlyPaid,
    recentInvoices: recent,
  };
}
