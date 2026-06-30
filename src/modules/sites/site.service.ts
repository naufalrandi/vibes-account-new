import { Op, type WhereOptions } from "sequelize";
import { Organization, Site } from "../../db/models";
import type { SiteType, SiteStatus } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface SiteView {
  id: string;
  orgId: string;
  tenantName: string;
  code: string;
  name: string;
  type: SiteType;
  country: string | null;
  address: string | null;
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
  status?: SiteStatus;
  isPrimary?: boolean;
  description?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export type UpdateSiteInput = Partial<Omit<CreateSiteInput, "orgId">>;

function toView(site: Site, tenantName: string): SiteView {
  return {
    id: site.id, orgId: site.orgId, tenantName,
    code: site.code, name: site.name, type: site.type,
    country: site.country, address: site.address, status: site.status, isPrimary: site.isPrimary,
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

async function nextSiteCode(): Promise<string> {
  const rows = await Site.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^STE-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `STE-${max + 1}`;
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
  const org = await Organization.findByPk(input.orgId);
  if (!org || org.type !== "Tenant") throw new BadRequestError("Sites can only belong to a Tenant organization", "NOT_A_TENANT");
  await assertCanSeeOrg(auth, org.id);
  if (input.isPrimary) {
    await Site.update({ isPrimary: false }, { where: { orgId: org.id } });
  }
  const site = await Site.create({
    orgId: org.id,
    code: await nextSiteCode(),
    name: input.name,
    type: input.type ?? "Branch Office",
    country: input.country ?? null,
    address: input.address ?? null,
    status: input.status ?? "Active",
    isPrimary: input.isPrimary ?? false,
    description: input.description ?? null,
    contactPerson: input.contactPerson ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: org.id, tenantId: org.tenantId,
    action: "site.created", entityType: "Site", entityId: site.id, sourceIp: ip, result: "Success",
  });
  return toView(site, org.name);
}

export async function updateSite(auth: AuthContext, id: string, input: UpdateSiteInput, ip: string | null): Promise<SiteView> {
  const { site, org } = await requireSite(auth, id);
  if (input.isPrimary) await Site.update({ isPrimary: false }, { where: { orgId: site.orgId } });
  if (input.name !== undefined) site.name = input.name;
  if (input.type !== undefined) site.type = input.type;
  if (input.country !== undefined) site.country = input.country ?? null;
  if (input.address !== undefined) site.address = input.address ?? null;
  if (input.status !== undefined) site.status = input.status;
  if (input.isPrimary !== undefined) site.isPrimary = input.isPrimary;
  if (input.description !== undefined) site.description = input.description ?? null;
  if (input.contactPerson !== undefined) site.contactPerson = input.contactPerson ?? null;
  if (input.contactEmail !== undefined) site.contactEmail = input.contactEmail ?? null;
  if (input.contactPhone !== undefined) site.contactPhone = input.contactPhone ?? null;
  await site.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: site.orgId, tenantId: org.tenantId,
    action: "site.updated", entityType: "Site", entityId: site.id, sourceIp: ip, result: "Success",
  });
  return toView(site, org.name);
}

export async function deleteSite(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const { site } = await requireSite(auth, id);
  if (site.isPrimary) throw new BadRequestError("The primary site cannot be deleted", "PRIMARY_SITE");
  const orgId = site.orgId;
  await site.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: "site.deleted", entityType: "Site", entityId: id, sourceIp: ip, result: "Success",
  });
}
