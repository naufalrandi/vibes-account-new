import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { SaasPipeline, SaasSubscription, SaasWorkspace, Organization, TenantProfile, Site, Role, User } from "../../db/models";
import type { SaasPipelineStage, SaasPipelineType, SaasPaymentMethod } from "../../db/models/saas.models";
import { sequelize } from "../../db/sequelize";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";
import { sendActivationInvite } from "../notifications/notification.service";
import { resolveSaasSubState, resolveSaasWsState, resolveSaasAccess } from "./lifecycle.service";
import { assertPipelineTransition } from "./pipeline.transitions";

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
 * 0072-saas-lifecycle.ts) landed with no code on top of. It originally
 * covered only listing, detail, quote creation and subscription renewal;
 * the pipeline's stage workflow (accept -> register -> verify payment ->
 * auto-provision a workspace) is implemented below — see pipeline.transitions.ts
 * for the stage/action legality table (OD `pipeRowActions`, app.html:10693).
 */

// belongsToMany generates a `setRoles` mixin at runtime; the User model does
// not declare it (mirrors tenant.service.ts / registration.service.ts).
type WithSetRoles = { setRoles: (roles: Role[], options?: { transaction?: Transaction }) => Promise<unknown> };

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
    // Filled in by the write-side transitions below (registration/payment were
    // always on the model but this view previously dropped them — a caller
    // walking the funnel needs to see the invoice number / payment state /
    // registration checklist the same way OD's pipe object exposes them).
    registration: p.registration, payment: p.payment,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

/** Append-only audit trail entry, unshifted — 1:1 with OD's `pipeLog` (app.html:10614). */
function pipeLog(p: SaasPipeline, msg: string): void {
  p.audit = [{ ts: new Date().toISOString(), msg }, ...(p.audit ?? [])];
}

/** Display name for audit messages (OD's `ocActor()`, falls back to 'AXIA Finance'). */
async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "AXIA Finance";
}

async function requirePipelineEntry(id: string): Promise<SaasPipeline> {
  const row = await SaasPipeline.findByPk(id);
  if (!row) throw new NotFoundError("Pipeline entry does not exist", "SAAS_PIPELINE_NOT_FOUND");
  return row;
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
  /** OD `pq-type` (js/core.js:7395). Defaults to 'New Tenant / SaaS', as OD's own `g('pq-type')||…` fallback does. */
  type?: SaasPipelineType;
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
    type: input.type ?? "New Tenant / SaaS",
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

// ---- Pipeline stage transitions ------------------------------------------

/** OD `pipeAccept` (app.html:10616) — jumps straight to 'Registration', never persists 'Accepted'. */
export async function acceptPipelineQuote(auth: AuthContext, id: string, ip: string | null) {
  requireManage(auth);
  const p = await requirePipelineEntry(id);
  assertPipelineTransition(p.stage, "accept");
  p.stage = "Registration";
  pipeLog(p, "Quote accepted — registration opened");
  await p.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.accepted",
    entityType: "SaasPipeline", entityId: p.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(p);
}

/** OD `pipeDecline` (app.html:10617) — the client-side confirm dialog is UI, not business logic. */
export async function declinePipelineQuote(auth: AuthContext, id: string, ip: string | null) {
  requireManage(auth);
  const p = await requirePipelineEntry(id);
  assertPipelineTransition(p.stage, "decline");
  p.stage = "Declined";
  pipeLog(p, "Quote declined");
  await p.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.declined",
    entityType: "SaasPipeline", entityId: p.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(p);
}

export interface SaveRegistrationInput {
  legalName: string;
  industry?: string | null;
  country?: string;
  address?: string | null;
  taxId?: string | null;
  siteName?: string;
  adminName: string;
  adminEmail: string;
  adminUser?: string;
  billingEmail?: string | null;
  termsAccepted: boolean;
}

/**
 * OD `pipeRegisterSave` (app.html:10636): the client registration checklist.
 * On completion an invoice is issued and the pipe moves to 'Awaiting Transfer'.
 * Validation mirrors OD's inline checks exactly (org name; admin name+email;
 * terms accepted).
 */
export async function saveRegistration(auth: AuthContext, id: string, input: SaveRegistrationInput, ip: string | null) {
  requireManage(auth);
  const p = await requirePipelineEntry(id);
  assertPipelineTransition(p.stage, "saveRegistration");
  if (!input.legalName.trim()) throw new BadRequestError("Legal organization name is required", "SAAS_REGISTRATION_ORG_REQUIRED");
  if (!input.adminName.trim() || !input.adminEmail.trim()) {
    throw new BadRequestError("Administrator name and email are required", "SAAS_REGISTRATION_ADMIN_REQUIRED");
  }
  if (!input.termsAccepted) throw new BadRequestError("Please accept the subscription terms", "SAAS_REGISTRATION_TERMS_REQUIRED");

  const registration = {
    legalName: input.legalName.trim(),
    industry: (input.industry ?? "").trim(),
    country: (input.country ?? "").trim() || "ID",
    address: (input.address ?? "").trim(),
    taxId: (input.taxId ?? "").trim(),
    siteName: (input.siteName ?? "").trim() || "Head Office",
    adminName: input.adminName.trim(),
    adminEmail: input.adminEmail.trim(),
    adminUser: (input.adminUser ?? "").trim(),
    billingEmail: (input.billingEmail ?? "").trim(),
    termsAccepted: true,
  };
  p.registration = registration;
  p.registrationComplete = true;
  p.tenantName = registration.legalName;
  p.contactPerson = registration.adminName;
  p.contactEmail = registration.adminEmail;
  p.country = registration.country;
  p.industry = registration.industry;
  const invoiceNo = `INV-${p.code.replace(/\D/g, "") || "0000"}`;
  p.payment = { ...(p.payment ?? {}), method: "Bank Transfer", state: "Awaiting Transfer", invoiceNo };
  p.stage = "Awaiting Transfer";
  pipeLog(p, `Registration completed · invoice ${invoiceNo} issued — awaiting bank transfer`);
  await p.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.registrationSaved",
    entityType: "SaasPipeline", entityId: p.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(p);
}

/** OD `pipeUploadProof` (app.html:10649). `proofUrl` defaults to 'transfer-receipt.pdf' like OD's file-name input. */
export async function uploadPaymentProof(auth: AuthContext, id: string, proofUrl: string | null | undefined, ip: string | null) {
  requireManage(auth);
  const p = await requirePipelineEntry(id);
  assertPipelineTransition(p.stage, "uploadProof");
  p.payment = { ...(p.payment ?? {}), state: "Under Verification", proofUrl: proofUrl?.trim() || "transfer-receipt.pdf" };
  p.stage = "Under Verification";
  pipeLog(p, "Transfer proof uploaded — awaiting finance verification");
  await p.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.proofUploaded",
    entityType: "SaasPipeline", entityId: p.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(p);
}

/**
 * OD `pipeVerifyPayment` (app.html:10654). In OD, confirming payment and
 * auto-provisioning happen in one synchronous click; here they are two
 * separate requests, so this sets `payment.state='Verified'` and rests the
 * pipe at the 'Verified' stage — see pipeline.transitions.ts for why that
 * stage is used here where OD never actually persisted it.
 */
export async function verifyPayment(auth: AuthContext, id: string, ip: string | null) {
  requireManage(auth);
  const p = await requirePipelineEntry(id);
  assertPipelineTransition(p.stage, "verifyPayment");
  const verifiedBy = await actorName(auth);
  p.payment = { ...(p.payment ?? {}), state: "Verified", verifiedBy, verifiedAt: new Date().toISOString() };
  p.stage = "Verified";
  pipeLog(p, `Payment verified by ${verifiedBy}`);
  await p.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "saas.pipeline.paymentVerified",
    entityType: "SaasPipeline", entityId: p.id, sourceIp: ip, result: "Success",
  });
  return pipelineView(p);
}

// ---- Provisioning engine --------------------------------------------------

/** OD's small AXIA_PROFILES product catalog (app.html:5905), name+standard only — this backend has no product master table. */
const SAAS_PRODUCT_CATALOG: Record<string, { name: string; standard: string }> = {
  ms: { name: "Management System", standard: "ISO 9001:2015" },
  lab: { name: "Lab IMS", standard: "ISO/IEC 17025:2017" },
  cab: { name: "CAB MS", standard: "ISO/IEC 17021-1:2015" },
  personnel: { name: "Personnel Certification MS", standard: "ISO/IEC 17024:2012" },
};
function saasProductInfo(code: string): { name: string; standard: string } {
  return SAAS_PRODUCT_CATALOG[code] ?? { name: code, standard: "—" };
}

/** `TEN-NNNN` tenant code, same convention as tenant.service.ts's `nextTenantCode` (not exported there). */
async function nextTenantCode(tx: Transaction): Promise<string> {
  const rows = await Organization.findAll({ where: { type: "Tenant" }, attributes: ["code"], transaction: tx });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^TEN-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TEN-${max + 1}`;
}

interface PipelineRegistration {
  legalName?: string;
  industry?: string;
  country?: string;
  address?: string;
  taxId?: string;
  siteName?: string;
  adminName?: string;
  adminEmail?: string;
  adminUser?: string;
  billingEmail?: string;
  termsAccepted?: boolean;
}

/**
 * This backend's equivalent of OD's `saasCreateTenantFromPipe` (app.html:10806).
 * OD builds a bare mock tenant object (org + one "Head Office" site + one
 * admin object, embedded as JSON — no real login, no real roles). This
 * backend has a real IAM layer, so "create the tenant" here means what it
 * means everywhere else this codebase provisions one (tenant.service.ts's
 * `provisionTenant`, registration.service.ts's `approveRegistration`): a
 * real Organization + TenantProfile + primary Site + Administrator Role
 * (granted the curated non-SP action set) + an admin User invited to
 * activate. Matching OD's own function exactly, `registration.siteName` is
 * collected during registration but never read here — the primary site is
 * always named "Head Office", same as OD's hardcoded value.
 *
 * `adminUser` is a deliberate departure: OD's mock admin object leaves
 * `username` blank (`p.registration.adminUser` is collected but never read
 * by `saasCreateTenantFromPipe`), which is harmless in a schema with no
 * uniqueness constraint. This backend's User.username is required and
 * unique, so a blank value is not an option — the collected `adminUser` is
 * used when present, else one is derived from the admin's email local-part
 * plus the pipeline code (guaranteed unique, since pipeline codes are).
 */
async function createTenantFromPipeline(fresh: SaasPipeline, tx: Transaction): Promise<string> {
  const reg = (fresh.registration ?? {}) as PipelineRegistration;
  const legalName = reg.legalName || fresh.tenantName;
  const adminName = reg.adminName || fresh.contactPerson || legalName;
  const adminEmail = reg.adminEmail || fresh.contactEmail;
  if (!adminEmail) throw new BadRequestError("Registration has no administrator email on file", "SAAS_REGISTRATION_INCOMPLETE");

  const code = await nextTenantCode(tx);
  const org = await Organization.create(
    {
      name: legalName, code, type: "Tenant", status: "Active",
      parentOrgId: fresh.partnerId, tenantId: null,
      email: adminEmail, phone: fresh.contactPhone, website: null,
      country: reg.country || fresh.country || "ID", address: reg.address || null,
      legalName, industry: reg.industry || fresh.industry || null,
      contactName: adminName, contactEmail: adminEmail, contactPhone: fresh.contactPhone,
      taxId: reg.taxId || null, branding: null, systemDefaults: null,
    },
    { transaction: tx },
  );
  org.tenantId = org.id;
  await org.save({ transaction: tx });

  await TenantProfile.create(
    {
      orgId: org.id, acquisition: fresh.partnerId ? "Partner" : "Direct", partnerOrgId: fresh.partnerId,
      billingOwner: adminName, status: "Active", subscriptionSummary: null, agreement: null,
      audit: [{ ts: new Date().toISOString(), msg: `Tenant auto-provisioned from ${fresh.code}` }],
    },
    { transaction: tx },
  );

  const siteCount = await Site.count({ transaction: tx });
  await Site.create(
    {
      orgId: org.id, code: `STE-${1001 + siteCount}`, name: "Head Office", type: "Head Office",
      country: reg.country || fresh.country || "ID", address: reg.address || null,
      city: null, state: null, postalCode: null, status: "Active", isPrimary: true,
      description: null, contactPerson: null, contactEmail: null, contactPhone: null,
    },
    { transaction: tx },
  );

  const role = await Role.create(
    { name: "Administrator", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true },
    { transaction: tx },
  );
  await grantEverythingExceptSpOnly(role.id, tx);

  const localPart = adminEmail.split("@")[0]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "admin";
  const username = reg.adminUser?.trim() || `${localPart}.${fresh.code.toLowerCase()}`;
  const activationToken = randomUUID();
  const admin = await User.create(
    {
      orgId: org.id, tenantId: org.id, fullName: adminName, username, email: adminEmail,
      passwordHash: null, status: "Pending Activation", position: "Administrator", workUnit: null,
      lastLogin: null, activationToken, resetToken: null, resetExpires: null,
    },
    { transaction: tx },
  );
  await (admin as unknown as WithSetRoles).setRoles([role], { transaction: tx });

  // Side effect after every row is staged; safe outside the transaction's
  // atomicity concern the same way registration.service.ts treats it (stub).
  sendActivationInvite(adminEmail, activationToken);
  return org.id;
}

/** Re-fetches fresh and marks the entry 'Provisioning Failed' — used when the transaction above rolled back. */
async function recordProvisioningFailure(id: string, err: unknown, auth: AuthContext, ip: string | null): Promise<void> {
  const fresh = await SaasPipeline.findByPk(id);
  if (!fresh) return;
  fresh.stage = "Provisioning Failed";
  const reason = err instanceof Error ? err.message : "Unknown error";
  pipeLog(fresh, `Provisioning failed — ${reason}`);
  await fresh.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, tenantId: fresh.tenantId,
    action: "saas.pipeline.provisioningFailed", entityType: "SaasPipeline", entityId: fresh.id, sourceIp: ip,
    result: "Failure", metadata: { reason },
  });
}

/**
 * OD `saasProvisionPipeline` (app.html:10813). Refuses to provision unless
 * `payment.state === 'Verified'` (the guard at app.html:10814) — checked
 * twice, once structurally (the transition table only allows this action
 * from 'Verified'/'Provisioning Failed') and once explicitly, matching OD's
 * own inline check, so a row that reaches an inconsistent state (e.g. a
 * direct DB edit) is still refused rather than silently provisioned.
 *
 * Creates the tenant if it does not exist, creates the subscription bundle
 * and one workspace per pipeline item, links tenantId/subId back onto the
 * pipeline entry, and advances the stage to 'Completed' — all inside one
 * transaction, so a mid-way failure (e.g. a duplicate org code) can never
 * leave a half-created tenant or a pipeline entry stuck claiming a
 * subscription that doesn't exist. On failure the entry is re-loaded fresh
 * (the failed transaction's in-memory mutations never committed) and moved
 * to 'Provisioning Failed' — a real OD stage — with an audit entry
 * describing why, so the failure is visible and retryable rather than
 * thrown away.
 */
export async function provisionPipeline(auth: AuthContext, id: string, ip: string | null) {
  requireManage(auth);
  const entry = await requirePipelineEntry(id);
  assertPipelineTransition(entry.stage, "provision");
  const payment = (entry.payment ?? {}) as { state?: string };
  if (payment.state !== "Verified") {
    throw new ConflictError("Payment must be verified before provisioning", "SAAS_PAYMENT_NOT_VERIFIED");
  }

  try {
    await sequelize.transaction(async (tx) => {
      const fresh = await SaasPipeline.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });
      if (!fresh) throw new NotFoundError("Pipeline entry does not exist", "SAAS_PIPELINE_NOT_FOUND");

      let tenantId = fresh.tenantId;
      if (!tenantId) tenantId = await createTenantFromPipeline(fresh, tx);

      const items = (fresh.items ?? []) as { product: string }[];
      const subCode = nextCode(await SaasSubscription.findAll({ attributes: ["code"], transaction: tx }), "SUB");
      const now = new Date();
      const sub = await SaasSubscription.create(
        {
          code: subCode, tenantId, pipelineId: fresh.id, partnerId: fresh.partnerId,
          products: items.map((i) => i.product),
          startDate: now, renewalDate: new Date(addMonthsIso(now, 12)), lastPaymentAt: now,
          amount: Number(fresh.amount), currency: fresh.currency,
          paymentMethod: ((fresh.payment ?? {}) as { method?: SaasPaymentMethod }).method ?? "Bank Transfer",
          ccAdequateLimit: false, autoRenew: false, term: "12 months", status: "Active",
          audit: [{ ts: now.toISOString(), msg: `Subscription created from ${fresh.code}` }],
        },
        { transaction: tx },
      );

      for (const item of items) {
        const info = saasProductInfo(item.product);
        const wsCode = nextCode(await SaasWorkspace.findAll({ attributes: ["code"], transaction: tx }), "WS");
        await SaasWorkspace.create(
          {
            code: wsCode, tenantId, subId: sub.id, product: item.product, name: info.name, standard: info.standard,
            status: "Active", provisionedAt: now,
            audit: [{ ts: now.toISOString(), msg: `Workspace provisioned (${info.name})` }],
          },
          { transaction: tx },
        );
      }

      fresh.tenantId = tenantId;
      fresh.subId = sub.id;
      fresh.stage = "Completed";
      pipeLog(fresh, `Provisioned — ${items.length} workspace(s) activated`);
      await fresh.save({ transaction: tx });

      await writeAudit(
        {
          actorUserId: auth.userId, organizationId: auth.orgId, tenantId,
          action: "saas.pipeline.provisioned", entityType: "SaasPipeline", entityId: fresh.id, sourceIp: ip,
          result: "Success", metadata: { subId: sub.id },
        },
        tx,
      );
    });
  } catch (err) {
    await recordProvisioningFailure(id, err, auth, ip);
    throw err;
  }

  return pipelineView(await requirePipelineEntry(id));
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
