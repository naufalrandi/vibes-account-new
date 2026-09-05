import { randomUUID } from "node:crypto";
import { Op, type WhereOptions, type Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import {
  Organization, User, TenantProfile, Site, FrameworkAssignment, RegistrationRequest, Role,
} from "../../db/models";
import type { TenantAcquisition, TenantStatus, TenantAuditEntry, TenantAgreementInfo } from "../../db/models/tenantProfile.model";
import type { SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { assignSubscription } from "../subscriptions/subscription.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

// belongsToMany generates a `setRoles` mixin at runtime; the User model does
// not declare it, so reach it through a narrow association-only cast (mirrors
// `src/db/seeders/seed.ts`'s `WithSetRoles`).
type WithSetRoles = { setRoles: (roles: Role[], options?: { transaction?: Transaction }) => Promise<unknown> };

export interface TenantView {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  legalName: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  acquisitionSource: TenantAcquisition;
  partnerOrgId: string | null;
  partnerName: string | null;
  primarySite: { id: string; code: string; name: string; type: string; status: string; isPrimary: boolean } | null;
  admin: { id: string; fullName: string; username: string; email: string | null; status: string } | null;
  agreement: TenantAgreementInfo | null;
  siteCount: number;
  frameworkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** OD `tenantEdit` (app.html:10483): SP-editable organization/contact fields. */
export interface UpdateTenantInput {
  name: string;
  acquisitionSource: TenantAcquisition;
  partnerOrgId?: string | null;
  email: string;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  address?: string | null;
}

export interface ProvisionTenantInput {
  organization: {
    name: string;
    code?: string;
    legalName?: string | null;
    industry?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    country?: string | null;
    address?: string | null;
    partnerOrgId?: string | null;
  };
  primarySite: {
    name: string; type?: SiteType; country?: string | null; address?: string | null;
    city?: string | null; state?: string | null; postalCode?: string | null;
  };
  admin: { fullName: string; username: string; email: string };
  mode: "draft" | "activate";
  /** Links the new tenant back to the Tenant Request it was provisioned from (0046). */
  registrationRequestId?: string | null;
}

const ORG_STATUS_FOR: Record<TenantStatus, Organization["status"]> = {
  Draft: "Draft",
  "Pending Activation": "Pending Approval",
  Active: "Active",
  Suspended: "Suspended",
  Inactive: "Inactive",
};

function nowEntry(msg: string): TenantAuditEntry {
  return { ts: new Date().toISOString(), msg };
}

async function nextTenantCode(): Promise<string> {
  const rows = await Organization.findAll({ where: { type: "Tenant" }, attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^TEN-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TEN-${max + 1}`;
}

async function buildView(org: Organization, profile: TenantProfile): Promise<TenantView> {
  const primary = await Site.findOne({ where: { orgId: org.id, isPrimary: true } });
  const admin = await User.findOne({ where: { orgId: org.id }, order: [["createdAt", "ASC"]] });
  const siteCount = await Site.count({ where: { orgId: org.id } });
  const frameworkCount = await FrameworkAssignment.count({ where: { orgId: org.id } });
  let partnerName: string | null = null;
  if (profile.partnerOrgId) {
    const p = await Organization.findByPk(profile.partnerOrgId);
    partnerName = p?.name ?? null;
  }
  return {
    id: org.id, code: org.code, name: org.name, status: profile.status,
    legalName: org.legalName, industry: org.industry, email: org.email, phone: org.phone,
    website: org.website, country: org.country, address: org.address,
    contactName: org.contactName, contactEmail: org.contactEmail, contactPhone: org.contactPhone,
    acquisitionSource: profile.acquisition, partnerOrgId: profile.partnerOrgId, partnerName,
    primarySite: primary
      ? { id: primary.id, code: primary.code, name: primary.name, type: primary.type, status: primary.status, isPrimary: true }
      : null,
    admin: admin
      ? { id: admin.id, fullName: admin.fullName, username: admin.username, email: admin.email, status: admin.status }
      : null,
    agreement: profile.agreement ?? null,
    siteCount, frameworkCount, createdAt: org.createdAt, updatedAt: profile.updatedAt,
  };
}

/**
 * Minimal Draft agreement for a freshly provisioned tenant, mirroring the shape
 * OD seeds (index.html:7224) so the Billing tab renders from day one. The
 * commercial dates stay null until the subscription actually starts.
 */
function draftAgreement(code: string): TenantAgreementInfo {
  const seq = code.replace(/\D/g, "").slice(-4).padStart(4, "0");
  return {
    number: `TA-${new Date().getFullYear()}-${seq}`,
    name: "VIBES Subscription Agreement",
    version: "1.0",
    status: "Draft",
    subscriptionType: "Professional",
    billingCycle: "Monthly",
    effectiveDate: null,
    expirationDate: null,
    currency: "IDR",
    paymentDueDays: 14,
    history: [{ date: new Date().toISOString().slice(0, 10), event: "Agreement Generated" }],
  };
}

async function resolveTenant(auth: AuthContext, orgId: string): Promise<{ org: Organization; profile: TenantProfile }> {
  const org = await Organization.findByPk(orgId);
  if (!org || org.type !== "Tenant") throw new NotFoundError("Tenant does not exist", "TENANT_NOT_FOUND");
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org.id)) throw new ForbiddenError();
  const profile = await TenantProfile.findOne({ where: { orgId } });
  if (!profile) throw new NotFoundError("Tenant profile missing", "TENANT_NOT_FOUND");
  return { org, profile };
}

export async function listTenants(auth: AuthContext): Promise<TenantView[]> {
  const where: WhereOptions = { type: "Tenant" };
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null) Object.assign(where, { id: { [Op.in]: ids } });
  const orgs = await Organization.findAll({ where, order: [["createdAt", "DESC"]] });
  const views: TenantView[] = [];
  for (const org of orgs) {
    const profile = await TenantProfile.findOne({ where: { orgId: org.id } });
    if (!profile) continue;
    views.push(await buildView(org, profile));
  }
  return views;
}

export async function getTenant(auth: AuthContext, orgId: string): Promise<TenantView> {
  const { org, profile } = await resolveTenant(auth, orgId);
  return buildView(org, profile);
}

export async function provisionTenant(auth: AuthContext, input: ProvisionTenantInput, ip: string | null): Promise<TenantView> {
  // Service-Owner only, deliberately. A Distributor's route to a new tenant is
  // submitRegistration() → SO review → approveRegistration(), which is the
  // governance control the Tenant Requests queue exists to enforce. Allowing
  // Distributors here was a second, unreviewed door to the same outcome.
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can provision tenants directly; partners submit a tenant request for review");
  const code = input.organization.code?.trim() || (await nextTenantCode());
  const dup = await Organization.findOne({ where: { code } });
  if (dup) throw new ConflictError(`Organization code ${code} is already in use`, "DUPLICATE_CODE");

  const activate = input.mode === "activate";
  // Caller is always the Service Owner now, so an attributed partner can only
  // come from the input (SP provisioning a tenant on a partner's behalf).
  const partnerOrgId = input.organization.partnerOrgId ?? null;
  const acquisition: TenantAcquisition = partnerOrgId ? "Partner" : "Direct";
  const status: TenantStatus = activate ? "Pending Activation" : "Draft";

  const newOrgId = await sequelize.transaction(async (tx) => {
    const org = await Organization.create({
      name: input.organization.name, code, type: "Tenant", status: ORG_STATUS_FOR[status],
      parentOrgId: partnerOrgId ?? auth.orgId, tenantId: null,
      email: input.organization.email ?? null, phone: input.organization.phone ?? null,
      website: input.organization.website ?? null, country: input.organization.country ?? null,
      address: input.organization.address ?? null, legalName: input.organization.legalName ?? null,
      industry: input.organization.industry ?? null,
      contactName: input.admin.fullName, contactEmail: input.admin.email, contactPhone: null,
      taxId: null, branding: null, systemDefaults: null,
    }, { transaction: tx });
    org.tenantId = org.id;
    await org.save({ transaction: tx });

    await TenantProfile.create({
      orgId: org.id, acquisition, partnerOrgId, billingOwner: input.admin.fullName,
      status, subscriptionSummary: null, agreement: draftAgreement(code),
      audit: [nowEntry("Tenant organization created")],
    }, { transaction: tx });

    // Primary site.
    const siteCount = await Site.count({ transaction: tx });
    await Site.create({
      orgId: org.id, code: `STE-${1001 + siteCount}`, name: input.primarySite.name,
      type: input.primarySite.type ?? "Head Office", country: input.primarySite.country ?? null,
      address: input.primarySite.address ?? null, status: "Active", isPrimary: true,
      city: input.primarySite.city ?? null, state: input.primarySite.state ?? null,
      postalCode: input.primarySite.postalCode ?? null,
      description: null, contactPerson: null, contactEmail: null, contactPhone: null,
    }, { transaction: tx });

    // Administrator role for the new tenant org, granted the same curated
    // non-SP action set the seeder gives its demo Distributor/Tenant admins
    // (`grantEverythingExceptSpOnly`) — without this the admin user below has
    // zero action grants and every authenticated request 403s.
    const role = await Role.create(
      { name: "Administrator", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true },
      { transaction: tx },
    );
    await grantEverythingExceptSpOnly(role.id, tx);

    // Admin user (invite when activating).
    const activationToken = randomUUID();
    const admin = await User.create({
      orgId: org.id, tenantId: org.id, fullName: input.admin.fullName, username: input.admin.username,
      email: input.admin.email, passwordHash: null, status: "Pending Activation",
      position: "Tenant Administrator", workUnit: null, lastLogin: null,
      activationToken, resetToken: null, resetExpires: null,
    }, { transaction: tx });
    await (admin as unknown as WithSetRoles).setRoles([role], { transaction: tx });

    await assignSubscription(org.id, "standard", tx);
    await writeAudit({
      actorUserId: auth.userId, organizationId: org.id, tenantId: org.id,
      action: "tenant.provisioned", entityType: "Tenant", entityId: org.id, sourceIp: ip, result: "Success",
      metadata: { code, mode: input.mode, acquisition },
    }, tx);
    if (activate) sendActivationInvite(input.admin.email, activationToken);

    // Best-effort link back to the source Tenant Request (OD `treqProvision`,
    // 7759 sets `TW.fromRequest`; `twFinish` at 7647 writes `rq.tenantId`).
    // Non-fatal: a stale/foreign id must never abort tenant creation itself.
    if (input.registrationRequestId) {
      const reqRow = await RegistrationRequest.findByPk(input.registrationRequestId, { transaction: tx });
      if (reqRow && reqRow.status === "Approved" && !reqRow.tenantId) {
        reqRow.tenantId = org.id;
        await reqRow.save({ transaction: tx });
      }
    }
    return org.id;
  });
  // Build the view AFTER commit so its queries (primary site, admin, counts) see
  // the just-created rows.
  const org = await Organization.findByPk(newOrgId);
  const profile = await TenantProfile.findOne({ where: { orgId: newOrgId } });
  if (!org || !profile) throw new NotFoundError("Provisioned tenant could not be loaded", "TENANT_NOT_FOUND");
  return buildView(org, profile);
}

/**
 * OD `tenantEdit` (index.html:7594-7616): edit the tenant's organization and
 * acquisition details from the SP tenant-detail header. SP-only, deliberately —
 * partners see a strictly read-only tenant view (index.html:8000) and route
 * changes through requests.
 */
export async function updateTenant(auth: AuthContext, orgId: string, input: UpdateTenantInput, ip: string | null): Promise<TenantView> {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Provider can edit tenant details");
  }
  const { org, profile } = await resolveTenant(auth, orgId);

  const partnerOrgId = input.acquisitionSource === "Partner" ? input.partnerOrgId ?? null : null;
  if (input.acquisitionSource === "Partner") {
    if (!partnerOrgId) {
      throw new BadRequestError("Partner is required for partner-acquired tenants", "PARTNER_REQUIRED");
    }
    const partner = await Organization.findByPk(partnerOrgId);
    if (!partner || partner.type !== "Distributor") {
      throw new BadRequestError("Assigned partner must be an existing partner organization", "PARTNER_NOT_FOUND");
    }
  }

  org.name = input.name;
  org.email = input.email;
  if (input.phone !== undefined) org.phone = input.phone ?? null;
  if (input.website !== undefined) org.website = input.website ?? null;
  if (input.country !== undefined) org.country = input.country ?? null;
  if (input.address !== undefined) org.address = input.address ?? null;
  await org.save();

  profile.acquisition = input.acquisitionSource;
  profile.partnerOrgId = partnerOrgId;
  profile.audit = [nowEntry("Tenant details updated"), ...profile.audit];
  await profile.save();

  await writeAudit({
    actorUserId: auth.userId, organizationId: org.id, tenantId: org.id,
    action: "tenant.updated", entityType: "Tenant", entityId: org.id, sourceIp: ip, result: "Success",
  });
  return buildView(org, profile);
}

// --- Lifecycle transitions -----------------------------------------------
async function transition(
  auth: AuthContext,
  orgId: string,
  opts: { from: TenantStatus[]; to: TenantStatus; action: string; msg: string; invite?: boolean },
  ip: string | null,
): Promise<TenantView> {
  const { org, profile } = await resolveTenant(auth, orgId);
  if (!opts.from.includes(profile.status)) {
    throw new ConflictError(`Cannot ${opts.action} a tenant that is "${profile.status}"`, "ILLEGAL_TRANSITION");
  }
  profile.status = opts.to;
  profile.audit = [nowEntry(opts.msg), ...profile.audit];
  await profile.save();
  org.status = ORG_STATUS_FOR[opts.to];
  await org.save();
  if (opts.invite) {
    const admin = await User.findOne({ where: { orgId, status: "Pending Activation" }, order: [["createdAt", "ASC"]] });
    if (admin) {
      const token = admin.activationToken ?? randomUUID();
      admin.activationToken = token;
      await admin.save();
      sendActivationInvite(admin.email, token);
    }
  }
  await writeAudit({
    actorUserId: auth.userId, organizationId: org.id, tenantId: org.id,
    action: `tenant.${opts.action}`, entityType: "Tenant", entityId: org.id, sourceIp: ip, result: "Success",
  });
  return buildView(org, profile);
}

export const sendActivation = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Draft"], to: "Pending Activation", action: "activation-sent", msg: "Activation invite sent", invite: true }, ip);
export const resendActivation = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Pending Activation"], to: "Pending Activation", action: "activation-resent", msg: "Activation invite resent", invite: true }, ip);
export const activate = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Pending Activation"], to: "Active", action: "activated", msg: "Tenant activated" }, ip);
export const suspend = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Active"], to: "Suspended", action: "suspended", msg: "Tenant suspended" }, ip);
export const resume = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Suspended"], to: "Active", action: "resumed", msg: "Tenant resumed" }, ip);
// OD offers Deactivate from every status except Inactive (`tenantHeaderActions`,
// app.html:10273) — including Draft and Pending Activation.
export const deactivate = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Draft", "Pending Activation", "Active", "Suspended"], to: "Inactive", action: "deactivated", msg: "Tenant deactivated" }, ip);
export const reactivate = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Inactive"], to: "Active", action: "reactivated", msg: "Tenant reactivated" }, ip);
