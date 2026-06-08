import { Op, type WhereOptions } from "sequelize";
import { FrameworkAssignment, Framework, Organization, Site } from "../../db/models";
import type { FrameworkAssignmentStatus } from "../../db/models/frameworkAssignment.model";
import { FRAMEWORK_ASSIGNMENT_STATUSES } from "../../db/models/frameworkAssignment.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateAssignmentInput {
  orgId: string;
  siteId: string;
  frameworkId: string;
  status?: FrameworkAssignmentStatus;
  assignedDate?: string | null;
  notes?: string | null;
}

export type UpdateAssignmentInput = Partial<Pick<CreateAssignmentInput, "status" | "assignedDate" | "notes">>;

export interface ListAssignmentFilters {
  orgId?: string;
  siteId?: string;
}

export interface AssignmentView {
  id: string;
  code: string;
  orgId: string;
  tenantName: string;
  siteId: string;
  siteName: string;
  frameworkId: string;
  frameworkName: string;
  status: FrameworkAssignmentStatus;
  assignedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Framework assignments are managed only by the Service Owner. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage framework assignments");
  }
}

/** Resolve the owning tenant organization or fail. */
async function requireTenantOrg(orgId: string): Promise<Organization> {
  const org = await Organization.findByPk(orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");
  if (org.type !== "Tenant") throw new BadRequestError("Frameworks can only be assigned to a Tenant organization", "NOT_A_TENANT");
  return org;
}

/** Next assignment code in the FA-#### sequence (starts at 1001). */
export async function nextAssignmentCode(): Promise<string> {
  const rows = await FrameworkAssignment.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = parseInt((r.code || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `FA-${max + 1}`;
}

function toView(row: FrameworkAssignment): AssignmentView {
  const org = row.get("Organization") as Organization | undefined;
  const site = row.get("Site") as Site | undefined;
  const fw = row.get("Framework") as Framework | undefined;
  return {
    id: row.id,
    code: row.code,
    orgId: row.orgId,
    tenantName: org?.name ?? "",
    siteId: row.siteId,
    siteName: site?.name ?? "",
    frameworkId: row.frameworkId,
    frameworkName: fw?.name ?? "",
    status: row.status,
    assignedDate: row.assignedDate,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadView(id: string): Promise<AssignmentView> {
  const row = await FrameworkAssignment.findByPk(id, { include: [Organization, Site, Framework] });
  if (!row) throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  return toView(row);
}

/**
 * List framework assignments. The Service Owner sees all; a Distributor sees
 * assignments for the tenants it parents; a Tenant sees only its own. An `orgId`
 * filter is honoured within the caller's visible scope.
 */
export async function listAssignments(auth: AuthContext, filters: ListAssignmentFilters = {}): Promise<AssignmentView[]> {
  const where: WhereOptions = {};
  if (filters.siteId) Object.assign(where, { siteId: filters.siteId });

  if (auth.orgType === "Tenant") {
    // Tenants only ever see their own org's assignments, ignoring any orgId filter.
    Object.assign(where, { orgId: auth.orgId });
  } else if (auth.orgType === "Distributor") {
    // Restrict to tenants parented by this distributor.
    const tenants = await Organization.findAll({ where: { parentOrgId: auth.orgId, type: "Tenant" }, attributes: ["id"] });
    const ids = tenants.map((t) => t.id);
    if (filters.orgId && !ids.includes(filters.orgId)) return [];
    const scoped = filters.orgId ? [filters.orgId] : ids;
    if (scoped.length === 0) return [];
    Object.assign(where, { orgId: { [Op.in]: scoped } });
  } else if (filters.orgId) {
    // Service Owner: honour the filter as given.
    Object.assign(where, { orgId: filters.orgId });
  }

  const rows = await FrameworkAssignment.findAll({
    where: Object.keys(where).length ? where : undefined,
    include: [Organization, Site, Framework],
    order: [["code", "ASC"]],
  });
  return rows.map(toView);
}

export async function getAssignment(auth: AuthContext, id: string): Promise<AssignmentView> {
  const row = await FrameworkAssignment.findByPk(id, { include: [Organization, Site, Framework] });
  if (!row) throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  // Scope: a Tenant may only read its own org's assignments; a Distributor may
  // only read assignments for tenants it parents. SO sees all. 404 (not 403) so
  // existence is not leaked across the boundary. Mirrors listAssignments scoping.
  if (auth.orgType === "Tenant" && row.orgId !== auth.orgId) {
    throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  }
  if (auth.orgType === "Distributor") {
    const org = (row.get("Organization") as Organization | undefined) ?? (await Organization.findByPk(row.orgId));
    if (!org || org.parentOrgId !== auth.orgId) {
      throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");
    }
  }
  return toView(row);
}

function assertValidStatus(status: FrameworkAssignmentStatus): void {
  if (!FRAMEWORK_ASSIGNMENT_STATUSES.includes(status)) {
    throw new BadRequestError(`Invalid status: ${status}`, "INVALID_STATUS");
  }
}

export async function createAssignment(auth: AuthContext, input: CreateAssignmentInput, ip: string | null): Promise<AssignmentView> {
  assertServiceOwner(auth);
  await requireTenantOrg(input.orgId);

  const site = await Site.findByPk(input.siteId);
  if (!site) throw new BadRequestError("Site does not exist", "SITE_NOT_FOUND");
  if (site.orgId !== input.orgId) throw new BadRequestError("Site does not belong to this tenant", "SITE_ORG_MISMATCH");

  const framework = await Framework.findByPk(input.frameworkId);
  if (!framework) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  const existing = await FrameworkAssignment.findOne({ where: { siteId: input.siteId, frameworkId: input.frameworkId } });
  if (existing) throw new ConflictError("This framework is already assigned to this site", "ASSIGNMENT_EXISTS");

  if (input.status) assertValidStatus(input.status);

  const row = await FrameworkAssignment.create({
    code: await nextAssignmentCode(),
    orgId: input.orgId,
    siteId: input.siteId,
    frameworkId: input.frameworkId,
    status: input.status ?? "Planned",
    assignedDate: input.assignedDate ?? null,
    notes: input.notes ?? null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: input.orgId,
    tenantId: input.orgId,
    action: "frameworkAssignment.created",
    entityType: "FrameworkAssignment",
    entityId: row.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(row.id);
}

export async function updateAssignment(auth: AuthContext, id: string, input: UpdateAssignmentInput, ip: string | null): Promise<AssignmentView> {
  assertServiceOwner(auth);
  const row = await FrameworkAssignment.findByPk(id);
  if (!row) throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");

  if (input.status !== undefined) {
    assertValidStatus(input.status);
    row.status = input.status;
  }
  if (input.assignedDate !== undefined) row.assignedDate = input.assignedDate ?? null;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  await row.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: row.orgId,
    tenantId: row.orgId,
    action: "frameworkAssignment.updated",
    entityType: "FrameworkAssignment",
    entityId: row.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(row.id);
}

export async function deleteAssignment(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const row = await FrameworkAssignment.findByPk(id);
  if (!row) throw new NotFoundError("Framework assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  const orgId = row.orgId;
  await row.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    tenantId: orgId,
    action: "frameworkAssignment.deleted",
    entityType: "FrameworkAssignment",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
