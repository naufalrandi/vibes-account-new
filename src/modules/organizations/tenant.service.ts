import { randomUUID } from "node:crypto";
import { Op, type WhereOptions } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { FrameworkAssignment, Organization, Site, Subscription, User } from "../../db/models";
import type { OrgStatus } from "../../db/models/organization.model";
import type { AuthContext } from "../../lib/scope";
import { canActOnOrg, organizationScopeWhere } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/**
 * AXIA tenant status labels (UI). The backend org enum is single-word; only the
 * "Pending Activation" label differs from the stored `PendingApproval` value.
 * Mapping is applied at the view boundary so no Postgres enum migration is needed.
 */
export type TenantStatus = "Draft" | "Pending Activation" | "Active" | "Suspended" | "Inactive";

const STATUS_TO_LABEL: Record<OrgStatus, TenantStatus> = {
  Draft: "Draft",
  PendingApproval: "Pending Activation",
  Active: "Active",
  Suspended: "Suspended",
  Inactive: "Inactive",
};

export interface TenantSiteLite {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  isPrimary: boolean;
}

export interface TenantAdminLite {
  id: string;
  fullName: string;
  username: string;
  email: string | null;
  status: string;
}

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
  acquisitionSource: "Direct" | "Partner";
  partnerOrgId: string | null;
  partnerName: string | null;
  primarySite: TenantSiteLite | null;
  admin: TenantAdminLite | null;
  siteCount: number;
  frameworkCount: number;
  createdAt: string;
  updatedAt: string;
}

function siteLite(site: Site): TenantSiteLite {
  return { id: site.id, code: site.code, name: site.name, type: site.type, status: site.status, isPrimary: site.isPrimary };
}

async function toView(org: Organization): Promise<TenantView> {
  const parent = org.parentOrgId ? await Organization.findByPk(org.parentOrgId) : null;
  const isPartnerSourced = parent?.type === "Distributor";
  const sites = await Site.findAll({ where: { orgId: org.id }, order: [["code", "ASC"]] });
  const primary = sites.find((s) => s.isPrimary) ?? null;
  const admin = await User.findOne({ where: { orgId: org.id }, order: [["createdAt", "ASC"]] });
  const frameworkCount = await FrameworkAssignment.count({ where: { orgId: org.id } });
  return {
    id: org.id,
    code: org.code,
    name: org.name,
    status: STATUS_TO_LABEL[org.status],
    legalName: org.legalName,
    industry: org.industry,
    email: org.email,
    phone: org.phone,
    website: org.website,
    country: org.country,
    address: org.address,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    acquisitionSource: isPartnerSourced ? "Partner" : "Direct",
    partnerOrgId: isPartnerSourced ? parent?.id ?? null : null,
    partnerName: isPartnerSourced ? parent?.name ?? null : null,
    primarySite: primary ? siteLite(primary) : null,
    admin: admin
      ? { id: admin.id, fullName: admin.fullName, username: admin.username, email: admin.email, status: admin.status }
      : null,
    siteCount: sites.length,
    frameworkCount,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

/** Tenant orgs visible to the caller, newest first. SO sees all; a distributor sees its own tenants. */
export async function listTenants(auth: AuthContext, filters: { search?: string } = {}): Promise<TenantView[]> {
  if (auth.orgType === "Tenant") throw new ForbiddenError("Tenants cannot list other tenants");
  const scope = organizationScopeWhere(auth);
  const and: WhereOptions[] = [scope as WhereOptions, { type: "Tenant" }];
  if (filters.search) {
    const term = `%${filters.search}%`;
    and.push({ [Op.or]: [{ name: { [Op.iLike]: term } }, { code: { [Op.iLike]: term } }] });
  }
  const orgs = await Organization.findAll({ where: { [Op.and]: and }, order: [["createdAt", "DESC"]] });
  return Promise.all(orgs.map(toView));
}

async function requireTenant(auth: AuthContext, id: string): Promise<Organization> {
  const org = await Organization.findByPk(id);
  if (!org || org.type !== "Tenant") throw new NotFoundError("Tenant does not exist", "TENANT_NOT_FOUND");
  if (!canActOnOrg(auth, org.id, org.parentOrgId)) throw new ForbiddenError();
  return org;
}

export async function getTenant(auth: AuthContext, id: string): Promise<TenantView> {
  const org = await requireTenant(auth, id);
  return toView(org);
}

// === Lifecycle ===
// AXIA tenant transitions (backend status in parens):
//   Draft --sendActivation--> Pending Activation (PendingApproval)
//   Pending Activation --resendActivation--> Pending Activation (no change, re-email)
//   Pending Activation --activate--> Active (SO only)
//   Active --suspend--> Suspended ; Suspended --resume--> Active (SO only)
//   Active|Suspended --deactivate--> Inactive ; Inactive --reactivate--> Active (SO only)
interface TransitionOpts {
  allowedFrom: OrgStatus[];
  to: OrgStatus;
  action: string;
  requireSO?: boolean;
  email?: boolean;
}

async function transitionTenant(auth: AuthContext, id: string, opts: TransitionOpts, ip: string | null): Promise<TenantView> {
  const org = await requireTenant(auth, id);
  if (opts.requireSO && auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("This action requires Service Owner approval");
  }
  if (!opts.allowedFrom.includes(org.status)) {
    throw new BadRequestError(
      `Cannot ${opts.action} a tenant in status ${STATUS_TO_LABEL[org.status]}`,
      "INVALID_TRANSITION",
    );
  }

  await sequelize.transaction(async (tx) => {
    org.status = opts.to;
    await org.save({ transaction: tx });
    await writeAudit(
      {
        actorUserId: auth.userId,
        organizationId: org.id,
        tenantId: org.id,
        action: opts.action,
        entityType: "Organization",
        entityId: org.id,
        sourceIp: ip,
        result: "Success",
      },
      tx,
    );
  });

  if (opts.email) await emailActivation(org.id);
  return toView(org);
}

/** Refresh the tenant admin's activation token and (re)send the invite. */
async function emailActivation(orgId: string): Promise<void> {
  const admin = await User.findOne({ where: { orgId }, order: [["createdAt", "ASC"]] });
  if (!admin || !admin.email) return;
  const token = randomUUID();
  admin.activationToken = token;
  if (admin.status !== "Active") admin.status = "PendingActivation";
  await admin.save();
  sendActivationInvite(admin.email, token);
}

export const sendActivation = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["Draft"], to: "PendingApproval", action: "tenant.activation_sent", email: true }, ip);

export const resendActivation = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["PendingApproval"], to: "PendingApproval", action: "tenant.activation_resent", email: true }, ip);

export const activateTenant = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["PendingApproval"], to: "Active", action: "tenant.activated", requireSO: true }, ip);

export const suspendTenant = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["Active"], to: "Suspended", action: "tenant.suspended" }, ip);

export const resumeTenant = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["Suspended"], to: "Active", action: "tenant.resumed", requireSO: true }, ip);

export const deactivateTenant = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["Active", "Suspended"], to: "Inactive", action: "tenant.deactivated" }, ip);

export const reactivateTenant = (auth: AuthContext, id: string, ip: string | null) =>
  transitionTenant(auth, id, { allowedFrom: ["Inactive"], to: "Active", action: "tenant.reactivated", requireSO: true }, ip);
