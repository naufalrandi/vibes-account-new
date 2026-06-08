import { Organization, Site, SiteRequest } from "../../db/models";
import type { SiteRequestProposed, SiteRequestStatus, SiteRequestType } from "../../db/models/siteRequest.model";
import type { SiteType } from "../../db/models/site.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { nextSiteCode } from "./site.service";

export interface CreateSiteRequestInput {
  orgId: string;
  type: SiteRequestType;
  siteId?: string | null;
  requestedBy?: string;
  proposed?: SiteRequestProposed;
  reason?: string | null;
}

export interface ListSiteRequestFilters {
  orgId?: string;
  type?: SiteRequestType;
  status?: SiteRequestStatus;
}

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
  createdAt: string;
  updatedAt: string;
}

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can review site requests");
  }
}

async function nextRequestCode(): Promise<string> {
  const rows = await SiteRequest.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = parseInt((r.code || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `SRQ-${max + 1}`;
}

function toView(request: SiteRequest): SiteRequestView {
  const org = request.get("Organization") as Organization | undefined;
  const site = request.get("Site") as Site | undefined;
  return {
    id: request.id,
    orgId: request.orgId,
    tenantName: org?.name ?? "",
    code: request.code,
    type: request.type,
    siteId: request.siteId,
    siteName: site?.name ?? null,
    requestedBy: request.requestedBy,
    proposed: request.proposed,
    reason: request.reason,
    status: request.status,
    provisioned: request.provisioned,
    provisionedSiteId: request.provisionedSiteId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

async function loadView(id: string): Promise<SiteRequestView> {
  const request = await SiteRequest.findByPk(id, { include: [Organization, Site] });
  if (!request) throw new NotFoundError("Site request does not exist", "SITE_REQUEST_NOT_FOUND");
  return toView(request);
}

export async function listSiteRequests(
  auth: AuthContext,
  filters: ListSiteRequestFilters = {},
): Promise<SiteRequestView[]> {
  assertServiceOwner(auth);
  const where: Record<string, unknown> = {};
  if (filters.orgId) where.orgId = filters.orgId;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  const rows = await SiteRequest.findAll({
    where: Object.keys(where).length ? where : undefined,
    include: [Organization, Site],
    order: [["createdAt", "DESC"]],
  });
  return rows.map(toView);
}

export async function getSiteRequest(auth: AuthContext, id: string): Promise<SiteRequestView> {
  assertServiceOwner(auth);
  return loadView(id);
}

export async function createSiteRequest(
  auth: AuthContext,
  input: CreateSiteRequestInput,
  ip: string | null,
): Promise<SiteRequestView> {
  assertServiceOwner(auth);
  const org = await Organization.findByPk(input.orgId);
  if (!org || org.type !== "Tenant") {
    throw new BadRequestError("Site requests must target a Tenant organization", "NOT_A_TENANT");
  }
  if (input.type !== "Site Addition") {
    if (!input.siteId) throw new BadRequestError("A target site is required for change/closure", "SITE_REQUIRED");
    const site = await Site.findOne({ where: { id: input.siteId, orgId: input.orgId } });
    if (!site) throw new BadRequestError("Target site does not exist for this tenant", "SITE_NOT_FOUND");
  }

  const request = await SiteRequest.create({
    orgId: input.orgId,
    code: await nextRequestCode(),
    type: input.type,
    siteId: input.siteId ?? null,
    requestedBy: input.requestedBy ?? "ServiceOwner",
    proposed: input.proposed ?? {},
    reason: input.reason ?? null,
    status: "Submitted",
    provisioned: false,
    provisionedSiteId: null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: input.orgId,
    tenantId: auth.tenantId,
    action: "siteRequest.created",
    entityType: "SiteRequest",
    entityId: request.id,
    sourceIp: ip,
    result: "Success",
    metadata: { type: input.type },
  });
  return loadView(request.id);
}

async function transition(
  auth: AuthContext,
  id: string,
  allowedFrom: SiteRequestStatus[],
  to: SiteRequestStatus,
  action: string,
  ip: string | null,
): Promise<SiteRequest> {
  assertServiceOwner(auth);
  const request = await SiteRequest.findByPk(id);
  if (!request) throw new NotFoundError("Site request does not exist", "SITE_REQUEST_NOT_FOUND");
  if (!allowedFrom.includes(request.status)) {
    throw new ConflictError(`Cannot ${action} a request that is ${request.status}`, "INVALID_TRANSITION");
  }
  request.status = to;
  await request.save();
  return request;
}

export async function reviewSiteRequest(auth: AuthContext, id: string, ip: string | null): Promise<SiteRequestView> {
  const request = await transition(auth, id, ["Submitted"], "Under Review", "review", ip);
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: request.orgId,
    tenantId: auth.tenantId,
    action: "siteRequest.reviewed",
    entityType: "SiteRequest",
    entityId: request.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(request.id);
}

export async function rejectSiteRequest(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<SiteRequestView> {
  const request = await transition(auth, id, ["Submitted", "Under Review"], "Rejected", "reject", ip);
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: request.orgId,
    tenantId: auth.tenantId,
    action: "siteRequest.rejected",
    entityType: "SiteRequest",
    entityId: request.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(request.id);
}

/**
 * Approve a request. Changes and closures apply immediately to the target site;
 * additions move to Approved and wait in the Site Provisioning queue.
 */
export async function approveSiteRequest(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<SiteRequestView> {
  const request = await transition(auth, id, ["Submitted", "Under Review"], "Approved", "approve", ip);

  if (request.type === "Site Change" && request.siteId) {
    const site = await Site.findByPk(request.siteId);
    if (site) {
      const p = request.proposed;
      if (p.name) site.name = p.name;
      if (p.address !== undefined) site.address = p.address ?? null;
      if (p.country !== undefined) site.country = p.country ?? null;
      if (p.isPrimary === true && !site.isPrimary) {
        await Site.update({ isPrimary: false }, { where: { orgId: site.orgId, isPrimary: true } });
        site.isPrimary = true;
        site.status = "Active";
      }
      await site.save();
    }
  } else if (request.type === "Site Closure" && request.siteId) {
    const site = await Site.findByPk(request.siteId);
    if (site) {
      if (site.isPrimary) throw new ConflictError("The primary site cannot be closed", "PRIMARY_SITE");
      site.status = "Inactive";
      await site.save();
    }
  }

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: request.orgId,
    tenantId: auth.tenantId,
    action: "siteRequest.approved",
    entityType: "SiteRequest",
    entityId: request.id,
    sourceIp: ip,
    result: "Success",
    metadata: { type: request.type },
  });
  return loadView(request.id);
}

/** Provision an approved Site Addition into a live Site on the tenant. */
export async function provisionSiteRequest(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<SiteRequestView> {
  assertServiceOwner(auth);
  const request = await SiteRequest.findByPk(id);
  if (!request) throw new NotFoundError("Site request does not exist", "SITE_REQUEST_NOT_FOUND");
  if (request.type !== "Site Addition") {
    throw new BadRequestError("Only Site Addition requests are provisioned", "NOT_AN_ADDITION");
  }
  if (request.status !== "Approved") throw new ConflictError("Only approved requests can be provisioned", "NOT_APPROVED");
  if (request.provisioned) throw new ConflictError("This request was already provisioned", "ALREADY_PROVISIONED");

  const org = await Organization.findByPk(request.orgId);
  const p = request.proposed;
  const site = await Site.create({
    orgId: request.orgId,
    code: await nextSiteCode(),
    name: p.name || "New Site",
    type: (p.siteType as SiteType) || "Branch Office",
    country: p.country ?? org?.country ?? null,
    address: p.address ?? null,
    status: "Active",
    isPrimary: false,
    description: null,
    contactPerson: null,
    contactEmail: null,
    contactPhone: null,
  });

  request.provisioned = true;
  request.provisionedSiteId = site.id;
  await request.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: request.orgId,
    tenantId: auth.tenantId,
    action: "siteRequest.provisioned",
    entityType: "Site",
    entityId: site.id,
    sourceIp: ip,
    result: "Success",
    metadata: { requestId: request.id },
  });
  return loadView(request.id);
}
