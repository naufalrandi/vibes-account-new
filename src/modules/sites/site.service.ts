import { Op, type Transaction, type WhereOptions } from "sequelize";
import { Organization, Site } from "../../db/models";
import { sequelize } from "../../db/sequelize";
import type { SiteType, SiteStatus } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { auditTenantId } from "../../lib/auditTenant";
import { maxCodeSeq, withCodeLock } from "../../lib/codeSeq";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface SiteView {
  id: string;
  orgId: string;
  tenantName: string;
  code: string;
  name: string;
  type: SiteType;
  country: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: SiteStatus;
  isPrimary: boolean;
  description: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSiteInput {
  orgId: string;
  name: string;
  type?: SiteType;
  country?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  status?: SiteStatus;
  isPrimary?: boolean;
  description?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export type UpdateSiteInput = Partial<Omit<CreateSiteInput, "orgId">>;

/**
 * OD governance contract (od-gap-analysis-2026-08-18 §2.3/§2.5, P0-5): sites are
 * controlled commercial objects provisioned only by the Service Provider.
 * Tenants may edit operational info on their own sites; partners are read-only.
 * Provisioning still flows through the site-requests module, which applies
 * approved changes to Site rows directly under SP auth.
 */
const OPERATIONAL_FIELDS: ReadonlySet<string> = new Set(["description", "contactPerson", "contactEmail", "contactPhone"]);

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Sites are managed by the Service Provider; submit a site request", "SITES_SP_MANAGED");
  }
}

/** SO edits anything; Tenant only operational fields; Distributor nothing. */
function assertCanUpdateFields(auth: AuthContext, input: UpdateSiteInput): void {
  if (auth.orgType === "ServiceOwner") return;
  if (auth.orgType === "Distributor") {
    throw new ForbiddenError("Partners have read-only access to sites; submit a request", "SITES_READ_ONLY");
  }
  const controlled = Object.entries(input)
    .filter(([key, value]) => value !== undefined && !OPERATIONAL_FIELDS.has(key))
    .map(([key]) => key);
  if (controlled.length > 0) {
    throw new ForbiddenError(
      `Controlled fields (${controlled.join(", ")}) are managed by the Service Provider; use a change request`,
      "SITE_FIELDS_CONTROLLED",
    );
  }
}

function toView(site: Site, tenantName: string): SiteView {
  return {
    id: site.id, orgId: site.orgId, tenantName,
    code: site.code, name: site.name, type: site.type,
    country: site.country, address: site.address, city: site.city, state: site.state, postalCode: site.postalCode, status: site.status, isPrimary: site.isPrimary,
    description: site.description, contactPerson: site.contactPerson,
    contactEmail: site.contactEmail, contactPhone: site.contactPhone,
    createdAt: site.createdAt, updatedAt: site.updatedAt,
  };
}

/** The set of Tenant org ids the actor may see sites for (SO → all). */
export async function visibleTenantOrgIds(auth: AuthContext): Promise<string[] | null> {
  if (auth.orgType === "ServiceOwner") return null; // null = unrestricted
  if (auth.orgType === "Tenant") return [auth.orgId];
  // Distributor: its own child Tenant orgs.
  const children = await Organization.findAll({ where: { parentOrgId: auth.orgId, type: "Tenant" }, attributes: ["id"] });
  return children.map((o) => o.id);
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

/** Locked `STE-NNNN` code (same lock key as every other site-code path); insert with the same `tx`. */
async function nextSiteCode(tx: Transaction): Promise<string> {
  return withCodeLock("STE", tx, async () => `STE-${Math.max(1000, await maxCodeSeq(Site, "STE", tx)) + 1}`);
}

export async function listSites(auth: AuthContext, orgId?: string): Promise<SiteView[]> {
  const where: WhereOptions = {};
  const ids = await visibleTenantOrgIds(auth);
  if (orgId) {
    await assertCanSeeOrg(auth, orgId);
    Object.assign(where, { orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  const sites = await Site.findAll({ where, include: [{ model: Organization, attributes: ["name"] }], order: [["createdAt", "DESC"]] });
  return sites.map((s) => toView(s, (s.get("Organization") as Organization | undefined)?.name ?? "—"));
}

async function requireSite(auth: AuthContext, id: string): Promise<{ site: Site; org: Organization }> {
  const site = await Site.findByPk(id, { include: [{ model: Organization }] });
  if (!site) throw new NotFoundError("Site does not exist", "SITE_NOT_FOUND");
  await assertCanSeeOrg(auth, site.orgId);
  return { site, org: site.get("Organization") as Organization };
}

export async function getSite(auth: AuthContext, id: string): Promise<SiteView> {
  const { site, org } = await requireSite(auth, id);
  return toView(site, org.name);
}

export async function createSite(auth: AuthContext, input: CreateSiteInput, ip: string | null): Promise<SiteView> {
  assertServiceOwner(auth);
  const org = await Organization.findByPk(input.orgId);
  if (!org || org.type !== "Tenant") throw new BadRequestError("Sites can only belong to a Tenant organization", "NOT_A_TENANT");
  await assertCanSeeOrg(auth, org.id);
  if (input.isPrimary && (input.status ?? "Active") !== "Active") {
    throw new ConflictError("The primary site must be Active", "PRIMARY_SITE_REQUIRED");
  }
  // Demoting the old primary and inserting the new one commit together, so the
  // org never has zero (or two) primary sites.
  const site = await sequelize.transaction(async (transaction) => {
    if (input.isPrimary) await Site.update({ isPrimary: false }, { where: { orgId: org.id }, transaction });
    return Site.create({
      orgId: org.id,
      code: await nextSiteCode(transaction),
      name: input.name,
      type: input.type ?? "Branch Office",
      country: input.country ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      status: input.status ?? "Active",
      isPrimary: input.isPrimary ?? false,
      description: input.description ?? null,
      contactPerson: input.contactPerson ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
    }, { transaction });
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: org.id, tenantId: org.tenantId,
    action: "site.created", entityType: "Site", entityId: site.id, sourceIp: ip, result: "Success",
  });
  return toView(site, org.name);
}

export async function updateSite(auth: AuthContext, id: string, input: UpdateSiteInput, ip: string | null): Promise<SiteView> {
  const { site, org } = await requireSite(auth, id);
  assertCanUpdateFields(auth, input);
  // An org always keeps exactly one primary site: the primary is replaced by
  // promoting another site, never by demoting or deactivating it in place.
  if (site.isPrimary && input.isPrimary === false) {
    throw new ConflictError("Make another site primary instead of unsetting the primary site", "PRIMARY_SITE_REQUIRED");
  }
  const nextStatus = input.status ?? site.status;
  const willBePrimary = input.isPrimary ?? site.isPrimary;
  const wasPrimary = site.isPrimary;
  if (willBePrimary && nextStatus !== "Active") {
    throw new ConflictError("The primary site must stay Active — make another site primary first", "PRIMARY_SITE_REQUIRED");
  }
  if (input.name !== undefined) site.name = input.name;
  if (input.type !== undefined) site.type = input.type;
  if (input.country !== undefined) site.country = input.country ?? null;
  if (input.address !== undefined) site.address = input.address ?? null;
  if (input.city !== undefined) site.city = input.city ?? null;
  if (input.state !== undefined) site.state = input.state ?? null;
  if (input.postalCode !== undefined) site.postalCode = input.postalCode ?? null;
  if (input.status !== undefined) site.status = input.status;
  if (input.isPrimary !== undefined) site.isPrimary = input.isPrimary;
  if (input.description !== undefined) site.description = input.description ?? null;
  if (input.contactPerson !== undefined) site.contactPerson = input.contactPerson ?? null;
  if (input.contactEmail !== undefined) site.contactEmail = input.contactEmail ?? null;
  if (input.contactPhone !== undefined) site.contactPhone = input.contactPhone ?? null;
  await sequelize.transaction(async (transaction) => {
    if (input.isPrimary && !wasPrimary) {
      await Site.update({ isPrimary: false }, { where: { orgId: site.orgId, id: { [Op.ne]: site.id } }, transaction });
    }
    await site.save({ transaction });
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: site.orgId, tenantId: org.tenantId,
    action: "site.updated", entityType: "Site", entityId: site.id, sourceIp: ip, result: "Success",
  });
  return toView(site, org.name);
}

export async function deleteSite(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const { site } = await requireSite(auth, id);
  if (site.isPrimary) throw new BadRequestError("The primary site cannot be deleted", "PRIMARY_SITE");
  const orgId = site.orgId;
  await site.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId, tenantId: auditTenantId(auth, orgId),
    action: "site.deleted", entityType: "Site", entityId: id, sourceIp: ip, result: "Success",
  });
}
