import { Op, type WhereOptions } from "sequelize";
import { Organization, Site, Framework, FrameworkAssignment } from "../../db/models";
import type { FrameworkAssignmentStatus } from "../../db/models/frameworkAssignment.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface FrameworkAssignmentView {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAssignmentInput {
  orgId: string;
  siteId: string;
  frameworkId: string;
  status?: FrameworkAssignmentStatus;
  assignedDate?: string | null;
  notes?: string | null;
}

export interface UpdateAssignmentInput {
  status?: FrameworkAssignmentStatus;
  assignedDate?: string | null;
  notes?: string | null;
}

async function buildView(fa: FrameworkAssignment): Promise<FrameworkAssignmentView> {
  const [org, site, fw] = await Promise.all([
    Organization.findByPk(fa.orgId),
    Site.findByPk(fa.siteId),
    Framework.findByPk(fa.frameworkId),
  ]);
  return {
    id: fa.id, code: fa.code, orgId: fa.orgId, tenantName: org?.name ?? "—",
    siteId: fa.siteId, siteName: site?.name ?? "—",
    frameworkId: fa.frameworkId, frameworkName: fw?.name ?? "—",
    status: fa.status, assignedDate: fa.assignedDate, notes: fa.notes,
    createdAt: fa.createdAt, updatedAt: fa.updatedAt,
  };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

/**
 * OD governance contract (od-gap-analysis-2026-08-18 §2.5/B3, P0-5): framework
 * assignments are SP-managed — OD renders the assignment table with
 * editable=false for both partner and tenant views. Mutations are SO-only.
 */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Framework assignments are managed by the Service Provider; submit a request", "ASSIGNMENTS_SP_MANAGED");
  }
}

async function nextCode(): Promise<string> {
  const rows = await FrameworkAssignment.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^FA-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `FA-${max + 1}`;
}

export async function listAssignments(
  auth: AuthContext,
  filters: { orgId?: string; siteId?: string } = {},
): Promise<FrameworkAssignmentView[]> {
  const where: WhereOptions = {};
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  if (filters.siteId) Object.assign(where, { siteId: filters.siteId });
  const rows = await FrameworkAssignment.findAll({ where, order: [["createdAt", "DESC"]] });
  return Promise.all(rows.map(buildView));
}

export async function createAssignment(auth: AuthContext, input: CreateAssignmentInput, ip: string | null): Promise<FrameworkAssignmentView> {
  assertServiceOwner(auth);
  await assertCanSeeOrg(auth, input.orgId);
  const site = await Site.findOne({ where: { id: input.siteId, orgId: input.orgId } });
  if (!site) throw new BadRequestError("Site does not belong to this tenant", "SITE_NOT_FOUND");
  const fw = await Framework.findByPk(input.frameworkId);
  if (!fw) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  const fa = await FrameworkAssignment.create({
    orgId: input.orgId, code: await nextCode(), siteId: input.siteId, frameworkId: input.frameworkId,
    status: input.status ?? "Planned", assignedDate: input.assignedDate ?? null, notes: input.notes ?? null,
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: input.orgId,
    action: "framework-assignment.created", entityType: "FrameworkAssignment", entityId: fa.id, sourceIp: ip, result: "Success",
  });
  return buildView(fa);
}

async function requireAssignment(auth: AuthContext, id: string): Promise<FrameworkAssignment> {
  const fa = await FrameworkAssignment.findByPk(id);
  if (!fa) throw new NotFoundError("Assignment does not exist", "ASSIGNMENT_NOT_FOUND");
  await assertCanSeeOrg(auth, fa.orgId);
  return fa;
}

export async function updateAssignment(auth: AuthContext, id: string, input: UpdateAssignmentInput, ip: string | null): Promise<FrameworkAssignmentView> {
  assertServiceOwner(auth);
  const fa = await requireAssignment(auth, id);
  if (input.status !== undefined) fa.status = input.status;
  if (input.assignedDate !== undefined) fa.assignedDate = input.assignedDate ?? null;
  if (input.notes !== undefined) fa.notes = input.notes ?? null;
  await fa.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: fa.orgId,
    action: "framework-assignment.updated", entityType: "FrameworkAssignment", entityId: fa.id, sourceIp: ip, result: "Success",
  });
  return buildView(fa);
}

export async function deleteAssignment(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const fa = await requireAssignment(auth, id);
  const orgId = fa.orgId;
  await fa.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: "framework-assignment.deleted", entityType: "FrameworkAssignment", entityId: id, sourceIp: ip, result: "Success",
  });
}
