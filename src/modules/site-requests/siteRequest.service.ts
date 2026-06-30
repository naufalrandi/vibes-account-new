import { Op, type WhereOptions } from "sequelize";
import { Organization, Site, SiteRequest } from "../../db/models";
import type { SiteRequestType, SiteRequestStatus, SiteRequestProposed } from "../../db/models/siteRequest.model";
import type { SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface SiteRequestView {
  id: string;
  orgId: string;
  tenantName: string;
  code: string;
  type: SiteRequestType;
  siteId: string | null;
  siteName: string | null;
  requestedBy: string;
  proposed: SiteRequestProposed;
  reason: string | null;
  status: SiteRequestStatus;
  provisioned: boolean;
  provisionedSiteId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSiteRequestInput {
  orgId: string;
  type: SiteRequestType;
  siteId?: string | null;
  requestedBy?: string;
  proposed?: SiteRequestProposed;
  reason?: string | null;
}

async function buildView(req: SiteRequest): Promise<SiteRequestView> {
  const org = await Organization.findByPk(req.orgId);
  const site = req.siteId ? await Site.findByPk(req.siteId) : null;
  return {
    id: req.id, orgId: req.orgId, tenantName: org?.name ?? "—", code: req.code,
    type: req.type, siteId: req.siteId, siteName: site?.name ?? null,
    requestedBy: req.requestedBy, proposed: req.proposed, reason: req.reason, status: req.status,
    provisioned: req.provisioned, provisionedSiteId: req.provisionedSiteId,
    createdAt: req.createdAt, updatedAt: req.updatedAt,
  };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function nextRequestCode(): Promise<string> {
  const rows = await SiteRequest.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^SRQ-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `SRQ-${max + 1}`;
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

export async function listSiteRequests(
  auth: AuthContext,
  filters: { orgId?: string; type?: SiteRequestType; status?: SiteRequestStatus } = {},
): Promise<SiteRequestView[]> {
  const where: WhereOptions = {};
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  if (filters.type) Object.assign(where, { type: filters.type });
  if (filters.status) Object.assign(where, { status: filters.status });
  const rows = await SiteRequest.findAll({ where, order: [["createdAt", "DESC"]] });
  return Promise.all(rows.map(buildView));
}

async function requireRequest(auth: AuthContext, id: string): Promise<SiteRequest> {
  const req = await SiteRequest.findByPk(id);
  if (!req) throw new NotFoundError("Site request does not exist", "SITE_REQUEST_NOT_FOUND");
  await assertCanSeeOrg(auth, req.orgId);
  return req;
}

export async function getSiteRequest(auth: AuthContext, id: string): Promise<SiteRequestView> {
  return buildView(await requireRequest(auth, id));
}

export async function createSiteRequest(auth: AuthContext, input: CreateSiteRequestInput, ip: string | null): Promise<SiteRequestView> {
  const org = await Organization.findByPk(input.orgId);
  if (!org || org.type !== "Tenant") throw new BadRequestError("Site requests belong to a Tenant organization", "NOT_A_TENANT");
  await assertCanSeeOrg(auth, org.id);
  if ((input.type === "Site Change" || input.type === "Site Closure") && !input.siteId) {
    throw new BadRequestError("A target site is required for change/closure requests", "SITE_REQUIRED");
  }
  const req = await SiteRequest.create({
    orgId: org.id, code: await nextRequestCode(), type: input.type, siteId: input.siteId ?? null,
    requestedBy: input.requestedBy ?? (auth.orgType === "Tenant" ? "Tenant" : auth.orgType === "Distributor" ? "Partner" : "Service Provider"),
    proposed: input.proposed ?? {}, reason: input.reason ?? null, status: "Submitted",
    provisioned: false, provisionedSiteId: null,
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: org.id, tenantId: org.tenantId,
    action: "site-request.created", entityType: "SiteRequest", entityId: req.id, sourceIp: ip, result: "Success",
  });
  return buildView(req);
}

async function setStatus(auth: AuthContext, id: string, from: SiteRequestStatus[], to: SiteRequestStatus, action: string, ip: string | null): Promise<SiteRequestView> {
  const req = await requireRequest(auth, id);
  if (!from.includes(req.status)) throw new ConflictError(`Cannot ${action} a request that is "${req.status}"`, "ILLEGAL_TRANSITION");
  req.status = to;
  await req.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: req.orgId,
    action: `site-request.${action}`, entityType: "SiteRequest", entityId: req.id, sourceIp: ip, result: "Success",
  });
  return buildView(req);
}

export const reviewSiteRequest = (a: AuthContext, id: string, ip: string | null) =>
  setStatus(a, id, ["Submitted"], "Under Review", "reviewed", ip);
export const rejectSiteRequest = (a: AuthContext, id: string, ip: string | null) =>
  setStatus(a, id, ["Submitted", "Under Review"], "Rejected", "rejected", ip);

/** Approve a request; Change/Closure are applied to the target site immediately. */
export async function approveSiteRequest(auth: AuthContext, id: string, ip: string | null): Promise<SiteRequestView> {
  const req = await requireRequest(auth, id);
  if (!["Submitted", "Under Review"].includes(req.status)) {
    throw new ConflictError(`Cannot approve a request that is "${req.status}"`, "ILLEGAL_TRANSITION");
  }
  if (req.type !== "Site Addition") {
    const site = req.siteId ? await Site.findByPk(req.siteId) : null;
    if (!site) throw new BadRequestError("Target site no longer exists", "SITE_NOT_FOUND");
    if (req.type === "Site Closure") {
      if (site.isPrimary) throw new BadRequestError("The primary site cannot be closed", "PRIMARY_SITE");
      site.status = "Inactive";
    } else {
      // Site Change — apply the proposed fields.
      const p = req.proposed;
      if (p.name) site.name = p.name;
      if (p.siteType) site.type = p.siteType as SiteType;
      if (p.country !== undefined) site.country = p.country ?? null;
      if (p.address !== undefined) site.address = p.address ?? null;
      if (p.isPrimary) {
        await Site.update({ isPrimary: false }, { where: { orgId: site.orgId } });
        site.isPrimary = true;
      }
    }
    await site.save();
  }
  req.status = "Approved";
  await req.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: req.orgId,
    action: "site-request.approved", entityType: "SiteRequest", entityId: req.id, sourceIp: ip, result: "Success",
  });
  return buildView(req);
}

/** Provision an approved Site Addition into a real site. */
export async function provisionSiteRequest(auth: AuthContext, id: string, ip: string | null): Promise<SiteRequestView> {
  const req = await requireRequest(auth, id);
  if (req.type !== "Site Addition") throw new BadRequestError("Only Site Addition requests are provisioned", "NOT_AN_ADDITION");
  if (req.status !== "Approved") throw new ConflictError("Only approved requests can be provisioned", "NOT_APPROVED");
  if (req.provisioned) throw new ConflictError("This request was already provisioned", "ALREADY_PROVISIONED");
  const site = await Site.create({
    orgId: req.orgId, code: await nextSiteCode(), name: req.proposed.name || "New Site",
    type: (req.proposed.siteType as SiteType) || "Branch Office",
    country: req.proposed.country ?? null, address: req.proposed.address ?? null,
    status: "Active", isPrimary: false, description: null, contactPerson: null, contactEmail: null, contactPhone: null,
  });
  req.provisioned = true;
  req.provisionedSiteId = site.id;
  await req.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: req.orgId,
    action: "site-request.provisioned", entityType: "SiteRequest", entityId: req.id, sourceIp: ip, result: "Success",
    metadata: { siteId: site.id },
  });
  return buildView(req);
}
