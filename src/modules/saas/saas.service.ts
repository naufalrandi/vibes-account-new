import { SaasPipeline, SaasSubscription, SaasWorkspace } from "../../db/models";
import type { SaasPipelineStage, SaasPaymentMethod } from "../../db/models/saas.models";
import type { AuthContext } from "../../lib/scope";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { resolveSaasSubState, resolveSaasWsState, resolveSaasAccess } from "./lifecycle.service";

/**
 * SaaS lifecycle layer (G-73): sales pipeline, subscriptions, workspaces.
 * SP-internal commercial data — every entry point here is gated by
 * `saas.read`/`saas.manage`, which SP_ONLY_ACTIONS keeps out of the curated
 * grant set every tenant/distributor admin gets (tenantGrants.ts), so a
 * tenant never sees another tenant's pipeline or subscription data via this
 * module. (Its own access to *its own* workspace is governed separately, by
 * the G-75 tenantScope gate.)
 *
 * This is the model/service/route layer OD's schema (migration
 * 0072-saas-lifecycle.ts) landed with no code on top of. It covers listing,
 * detail, quote creation and subscription renewal — the pipeline's stage
 * workflow (accept -> register -> verify payment -> auto-provision a
 * workspace) is not built; see the G-73 report for what remains.
 */

const requireManage = (auth: AuthContext) => {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages SaaS lifecycle records");
};

/** Next zero-padded `<PREFIX>-NNNN` code given the existing rows' codes (mirrors billing.service.ts nextCode). */
function nextCode(existing: { code: string }[], prefix: string): string {
  let max = 0;
  for (const r of existing) {
    const m = r.code.match(new RegExp(`${prefix}-(\\d+)$`));
    if (m) {
      const v = Number.parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function addMonthsIso(date: Date, months: number): string {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// ---- Pipeline ---------------------------------------------------------

function pipelineView(p: SaasPipeline) {
  return {
    id: p.id, code: p.code, tenantId: p.tenantId, tenantName: p.tenantName, partnerId: p.partnerId,
    industry: p.industry, country: p.country, contactPerson: p.contactPerson, contactEmail: p.contactEmail,
    contactPhone: p.contactPhone, type: p.type, stage: p.stage, items: p.items, amount: Number(p.amount),
    currency: p.currency, registrationComplete: p.registrationComplete, subId: p.subId, audit: p.audit,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export async function listPipeline(): Promise<ReturnType<typeof pipelineView>[]> {
  const rows = await SaasPipeline.findAll({ order: [["createdAt", "DESC"]] });
  return rows.map(pipelineView);
}

export async function getPipelineEntry(id: string): Promise<ReturnType<typeof pipelineView>> {
  const row = await SaasPipeline.findByPk(id);
  if (!row) throw new NotFoundError("Pipeline entry does not exist", "SAAS_PIPELINE_NOT_FOUND");
  return pipelineView(row);
}

export interface CreatePipelineInput {
  tenantName: string;
  partnerId?: string | null;
  industry?: string | null;
  country?: string;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  items: unknown[];
  amount: number;
  currency?: string;
}

/** Enters a prospective tenant into the pipeline at 'Quote Sent' (OD app.html:6043 mkPipe). */
export async function createPipelineQuote(auth: AuthContext, input: CreatePipelineInput, ip: string | null) {
  requireManage(auth);
  const row = await SaasPipeline.create({
    code: nextCode(await SaasPipeline.findAll({ attributes: ["code"] }), "PIPE"),
    tenantId: null,
    tenantName: input.tenantName,
    partnerId: input.partnerId ?? null,
    industry: input.industry ?? null,
    country: input.country ?? "ID",
    contactPerson: input.contactPerson ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    type: "New Tenant / SaaS",
    stage: "Quote Sent",
    items: input.items,
    amount: input.amount,
    currency: input.currency ?? "IDR",
    registrationComplete: false,
    registration: {},
    payment: {},
    subId: null,
    audit: [{ ts: new Date().toISOString(), msg: `Quote sent to ${input.tenantName}` }],
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.quoteCreated",
    entityType: "SaasPipeline", entityId: row.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(row);
}

// ---- Subscriptions ------------------------------------------------------

function subscriptionView(s: SaasSubscription) {
  const resolved = resolveSaasSubState(s);
  return {
    id: s.id, code: s.code, tenantId: s.tenantId, pipelineId: s.pipelineId, partnerId: s.partnerId,
    products: s.products, startDate: s.startDate, renewalDate: s.renewalDate, lastPaymentAt: s.lastPaymentAt,
    amount: Number(s.amount), currency: s.currency, paymentMethod: s.paymentMethod, ccAdequateLimit: s.ccAdequateLimit,
    autoRenew: s.autoRenew, term: s.term, status: s.status, graceStartedAt: s.graceStartedAt, archivedAt: s.archivedAt,
    audit: s.audit, createdAt: s.createdAt, updatedAt: s.updatedAt,
    // Derived (never persisted) — 1:1 with OD's saasSubState.
    state: resolved.state, daysLeft: resolved.daysLeft ?? null,
  };
}

export async function listSubscriptions(): Promise<ReturnType<typeof subscriptionView>[]> {
  const rows = await SaasSubscription.findAll({ order: [["createdAt", "DESC"]] });
  return rows.map(subscriptionView);
}

export async function getSubscription(id: string): Promise<ReturnType<typeof subscriptionView>> {
  const row = await SaasSubscription.findByPk(id);
  if (!row) throw new NotFoundError("Subscription does not exist", "SAAS_SUBSCRIPTION_NOT_FOUND");
  return subscriptionView(row);
}

/**
 * Renews a subscription for a further 12-month term — the only way out of
 * Grace 1/Grace 2/Archived (payment, bank-transfer-verified, is the sole
 * gate; OD app.html:10830 the "Confirm Renewal Payment" modal). Extends from
 * the current renewalDate when it is still in the future (early renewal),
 * otherwise from now. Clears grace/archive markers and reactivates the
 * subscription — this is also what lifts a G-75 lockout for the tenant.
 */
export async function renewSubscription(auth: AuthContext, id: string, ip: string | null) {
  requireManage(auth);
  const row = await SaasSubscription.findByPk(id);
  if (!row) throw new NotFoundError("Subscription does not exist", "SAAS_SUBSCRIPTION_NOT_FOUND");

  const now = new Date();
  const base = row.renewalDate && row.renewalDate.getTime() > now.getTime() ? row.renewalDate : now;
  const wasLapsed = row.status !== "Active" || (row.renewalDate !== null && row.renewalDate.getTime() <= now.getTime());

  row.renewalDate = new Date(addMonthsIso(base, 12));
  row.lastPaymentAt = now;
  row.status = "Active";
  row.graceStartedAt = null;
  row.archivedAt = null;
  row.audit = [
    { ts: now.toISOString(), msg: `${wasLapsed ? "Reactivated" : "Renewed"} 12 months — bank transfer verified` },
    ...(row.audit ?? []),
  ];
  await row.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, tenantId: row.tenantId,
    action: wasLapsed ? "saas.subscription.reactivated" : "saas.subscription.renewed",
    entityType: "SaasSubscription", entityId: row.id, sourceIp: ip, result: "Success",
  });
  return subscriptionView(row);
}

// ---- Workspaces -----------------------------------------------------------

function workspaceView(w: SaasWorkspace, sub: SaasSubscription | null) {
  const wsState = resolveSaasWsState(w, sub);
  return {
    id: w.id, code: w.code, tenantId: w.tenantId, subId: w.subId, product: w.product, name: w.name,
    standard: w.standard, status: w.status, provisionedAt: w.provisionedAt, audit: w.audit,
    createdAt: w.createdAt, updatedAt: w.updatedAt,
    // Derived (never persisted) — 1:1 with OD's saasWsState/saasWsAccess.
    state: wsState, access: resolveSaasAccess(wsState),
  };
}

export async function listWorkspaces(): Promise<ReturnType<typeof workspaceView>[]> {
  const rows = await SaasWorkspace.findAll({ order: [["provisionedAt", "DESC"]] });
  const subs = await SaasSubscription.findAll({ where: { id: rows.map((r) => r.subId) } });
  const byId = new Map(subs.map((s) => [s.id, s]));
  return rows.map((w) => workspaceView(w, byId.get(w.subId) ?? null));
}

export async function getWorkspace(id: string): Promise<ReturnType<typeof workspaceView>> {
  const row = await SaasWorkspace.findByPk(id);
  if (!row) throw new NotFoundError("Workspace does not exist", "SAAS_WORKSPACE_NOT_FOUND");
  const sub = await SaasSubscription.findByPk(row.subId);
  return workspaceView(row, sub);
}

export type { SaasPipelineStage, SaasPaymentMethod };
