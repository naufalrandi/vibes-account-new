import { randomUUID } from "node:crypto";
import { Op, type WhereOptions } from "sequelize";
import { sequelize } from "../../db/sequelize";
import {
  Organization, User, TenantProfile, Site, FrameworkAssignment,
} from "../../db/models";
import type { TenantAcquisition, TenantStatus, TenantAuditEntry } from "../../db/models/tenantProfile.model";
import type { SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { assignSubscription } from "../subscriptions/subscription.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

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
  siteCount: number;
  frameworkCount: number;
  createdAt: Date;
  updatedAt: Date;
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
  primarySite: { name: string; type?: SiteType; country?: string | null; address?: string | null };
  admin: { fullName: string; username: string; email: string };
  mode: "draft" | "activate";
}

const ORG_STATUS_FOR: Record<TenantStatus, Organization["status"]> = {
  Draft: "Draft",
  "Pending Activation": "PendingApproval",
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
    siteCount, frameworkCount, createdAt: org.createdAt, updatedAt: profile.updatedAt,
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
  if (auth.orgType !== "ServiceOwner" && auth.orgType !== "Distributor") throw new ForbiddenError();
  const code = input.organization.code?.trim() || (await nextTenantCode());
  const dup = await Organization.findOne({ where: { code } });
  if (dup) throw new ConflictError(`Organization code ${code} is already in use`, "DUPLICATE_CODE");

  const activate = input.mode === "activate";
  const partnerOrgId = input.organization.partnerOrgId ?? (auth.orgType === "Distributor" ? auth.orgId : null);
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
      status, subscriptionSummary: null, audit: [nowEntry("Tenant organization created")],
    }, { transaction: tx });

    // Primary site.
    const siteCount = await Site.count({ transaction: tx });
    await Site.create({
      orgId: org.id, code: `STE-${1001 + siteCount}`, name: input.primarySite.name,
      type: input.primarySite.type ?? "Head Office", country: input.primarySite.country ?? null,
      address: input.primarySite.address ?? null, status: "Active", isPrimary: true,
      description: null, contactPerson: null, contactEmail: null, contactPhone: null,
    }, { transaction: tx });

    // Admin user (invite when activating).
    const activationToken = randomUUID();
    await User.create({
      orgId: org.id, tenantId: org.id, fullName: input.admin.fullName, username: input.admin.username,
      email: input.admin.email, passwordHash: null, status: "PendingActivation",
      position: "Tenant Administrator", workUnit: null, lastLogin: null,
      activationToken, resetToken: null, resetExpires: null,
    }, { transaction: tx });

    await assignSubscription(org.id, "standard", tx);
    await writeAudit({
      actorUserId: auth.userId, organizationId: org.id, tenantId: org.id,
      action: "tenant.provisioned", entityType: "Tenant", entityId: org.id, sourceIp: ip, result: "Success",
      metadata: { code, mode: input.mode, acquisition },
    }, tx);
    if (activate) sendActivationInvite(input.admin.email, activationToken);
    return org.id;
  });
  // Build the view AFTER commit so its queries (primary site, admin, counts) see
  // the just-created rows.
  const org = await Organization.findByPk(newOrgId);
  const profile = await TenantProfile.findOne({ where: { orgId: newOrgId } });
  if (!org || !profile) throw new NotFoundError("Provisioned tenant could not be loaded", "TENANT_NOT_FOUND");
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
    const admin = await User.findOne({ where: { orgId, status: "PendingActivation" }, order: [["createdAt", "ASC"]] });
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
export const deactivate = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Active", "Suspended"], to: "Inactive", action: "deactivated", msg: "Tenant deactivated" }, ip);
export const reactivate = (a: AuthContext, id: string, ip: string | null) =>
  transition(a, id, { from: ["Inactive"], to: "Active", action: "reactivated", msg: "Tenant reactivated" }, ip);
