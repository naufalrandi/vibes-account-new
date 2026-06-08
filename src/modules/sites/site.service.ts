import { Op } from "sequelize";
import { Organization, Site } from "../../db/models";
import type { SiteStatus, SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

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

export interface ListSiteFilters {
  orgId?: string;
}

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
  createdAt: string;
  updatedAt: string;
}

/** Sites are controlled commercial objects — only the Service Owner may manage them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage sites");
  }
}

/** Resolve the owning tenant organization or fail. */
async function requireTenantOrg(orgId: string): Promise<Organization> {
  const org = await Organization.findByPk(orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");
  if (org.type !== "Tenant") throw new BadRequestError("Sites can only belong to a Tenant organization", "NOT_A_TENANT");
  return org;
}

/** Next site code in the STE-#### sequence (starts at 1001). */
export async function nextSiteCode(): Promise<string> {
  const sites = await Site.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const s of sites) {
    const n = parseInt((s.code || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `STE-${max + 1}`;
}

export function toView(site: Site): SiteView {
  const org = site.get("Organization") as Organization | undefined;
  return {
    id: site.id,
    orgId: site.orgId,
    tenantName: org?.name ?? "",
    code: site.code,
    name: site.name,
    type: site.type,
    country: site.country,
    address: site.address,
    status: site.status,
    isPrimary: site.isPrimary,
    description: site.description,
    contactPerson: site.contactPerson,
    contactEmail: site.contactEmail,
    contactPhone: site.contactPhone,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

async function loadView(id: string): Promise<SiteView> {
  const site = await Site.findByPk(id, { include: [Organization] });
  if (!site) throw new NotFoundError("Site does not exist", "SITE_NOT_FOUND");
  return toView(site);
}

export async function listSites(auth: AuthContext, filters: ListSiteFilters = {}): Promise<SiteView[]> {
  assertServiceOwner(auth);
  const where = filters.orgId ? { orgId: filters.orgId } : undefined;
  const rows = await Site.findAll({ where, include: [Organization], order: [["code", "ASC"]] });
  return rows.map(toView);
}

export async function getSite(auth: AuthContext, id: string): Promise<SiteView> {
  assertServiceOwner(auth);
  return loadView(id);
}

/** Demote any existing primary site for an org so only one stays primary. */
async function clearPrimary(orgId: string, exceptId?: string): Promise<void> {
  await Site.update(
    { isPrimary: false },
    { where: { orgId, isPrimary: true, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) } },
  );
}

export async function createSite(auth: AuthContext, input: CreateSiteInput, ip: string | null): Promise<SiteView> {
  assertServiceOwner(auth);
  await requireTenantOrg(input.orgId);
  if (input.isPrimary) await clearPrimary(input.orgId);

  const site = await Site.create({
    orgId: input.orgId,
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
    actorUserId: auth.userId,
    organizationId: input.orgId,
    tenantId: auth.tenantId,
    action: "site.created",
    entityType: "Site",
    entityId: site.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(site.id);
}

export async function updateSite(
  auth: AuthContext,
  id: string,
  input: UpdateSiteInput,
  ip: string | null,
): Promise<SiteView> {
  assertServiceOwner(auth);
  const site = await Site.findByPk(id);
  if (!site) throw new NotFoundError("Site does not exist", "SITE_NOT_FOUND");

  if (input.isPrimary === true && !site.isPrimary) await clearPrimary(site.orgId, site.id);
  if (input.isPrimary === false && site.isPrimary) {
    throw new ConflictError("A tenant must keep one primary site — promote another site instead", "PRIMARY_REQUIRED");
  }

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
    actorUserId: auth.userId,
    organizationId: site.orgId,
    tenantId: auth.tenantId,
    action: "site.updated",
    entityType: "Site",
    entityId: site.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(site.id);
}

export async function deleteSite(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const site = await Site.findByPk(id);
  if (!site) throw new NotFoundError("Site does not exist", "SITE_NOT_FOUND");
  if (site.isPrimary) throw new ConflictError("The primary site cannot be deleted", "PRIMARY_SITE");

  await site.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: site.orgId,
    tenantId: auth.tenantId,
    action: "site.deleted",
    entityType: "Site",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
