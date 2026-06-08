import { randomUUID } from "node:crypto";
import { sequelize } from "../../db/sequelize";
import { Organization, Site, User } from "../../db/models";
import type { SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { nextSiteCode } from "../sites/site.service";
import { assignSubscription } from "../subscriptions/subscription.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { getTenant, type TenantView } from "./tenant.service";
import { BadRequestError, ConflictError, ForbiddenError } from "../../lib/errors";

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
    name: string;
    type?: SiteType;
    country?: string | null;
    address?: string | null;
  };
  admin: {
    fullName: string;
    username: string;
    email: string;
  };
  // "draft" stages everything without inviting the admin; "activate" sends the
  // activation invite and moves the tenant to Pending Activation.
  mode: "draft" | "activate";
}

/** Next tenant code in the TEN-#### sequence (starts at 1001). */
async function nextTenantCode(): Promise<string> {
  const orgs = await Organization.findAll({ where: { type: "Tenant" }, attributes: ["code"] });
  let max = 1000;
  for (const o of orgs) {
    const m = /^TEN-(\d+)$/.exec(o.code || "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `TEN-${max + 1}`;
}

/**
 * Provision a tenant directly (Service Owner action) — the monolith equivalent of
 * the registration saga, but operator-initiated from the Create Tenant wizard. One
 * transaction creates the tenant org, its primary site, an initial Tenant
 * Administrator, and a subscription. In "activate" mode the admin is invited and
 * the tenant moves to Pending Activation; in "draft" mode nothing is sent.
 */
export async function provisionTenant(auth: AuthContext, input: ProvisionTenantInput, ip: string | null): Promise<TenantView> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can provision tenants");

  // Resolve the acquisition parent: a partner (Distributor) when supplied,
  // otherwise the Service Owner org (direct acquisition).
  let parentOrgId = auth.orgId;
  if (input.organization.partnerOrgId) {
    const partner = await Organization.findByPk(input.organization.partnerOrgId);
    if (!partner || partner.type !== "Distributor") {
      throw new BadRequestError("partnerOrgId must reference a Distributor organization", "INVALID_PARTNER");
    }
    parentOrgId = partner.id;
  }

  const code = input.organization.code?.trim() || (await nextTenantCode());
  const clash = await Organization.findOne({ where: { code } });
  if (clash) throw new ConflictError(`Organization code ${code} is already in use`, "CODE_EXISTS");

  const activationToken = input.mode === "activate" ? randomUUID() : null;
  let adminEmail: string | null = null;

  const tenant = await sequelize.transaction(async (tx) => {
    const org = await Organization.create(
      {
        name: input.organization.name,
        code,
        type: "Tenant",
        status: input.mode === "activate" ? "PendingApproval" : "Draft",
        parentOrgId,
        tenantId: null,
        email: input.organization.email ?? null,
        phone: input.organization.phone ?? null,
        website: input.organization.website ?? null,
        country: input.organization.country ?? null,
        address: input.organization.address ?? null,
        legalName: input.organization.legalName ?? null,
        industry: input.organization.industry ?? null,
      },
      { transaction: tx },
    );
    org.tenantId = org.id;
    await org.save({ transaction: tx });

    await Site.create(
      {
        orgId: org.id,
        code: await nextSiteCode(),
        name: input.primarySite.name,
        type: input.primarySite.type ?? "Head Office",
        country: input.primarySite.country ?? null,
        address: input.primarySite.address ?? null,
        status: "Active",
        isPrimary: true,
        description: null,
        contactPerson: null,
        contactEmail: null,
        contactPhone: null,
      },
      { transaction: tx },
    );

    await assignSubscription(org.id, "standard", tx);

    const admin = await User.create(
      {
        orgId: org.id,
        tenantId: org.id,
        fullName: input.admin.fullName,
        username: input.admin.username,
        email: input.admin.email,
        passwordHash: null,
        status: "PendingActivation",
        position: "Administrator",
        workUnit: null,
        lastLogin: null,
        activationToken,
        resetToken: null,
        resetExpires: null,
      },
      { transaction: tx },
    );
    adminEmail = admin.email;

    await writeAudit(
      {
        actorUserId: auth.userId,
        organizationId: org.id,
        tenantId: org.id,
        action: input.mode === "activate" ? "tenant.provisioned" : "tenant.drafted",
        entityType: "Organization",
        entityId: org.id,
        sourceIp: ip,
        result: "Success",
      },
      tx,
    );

    return org;
  });

  // Side effect after commit — only invite when activating.
  if (input.mode === "activate" && activationToken && adminEmail) {
    sendActivationInvite(adminEmail, activationToken);
  }

  return getTenant(auth, tenant.id);
}
