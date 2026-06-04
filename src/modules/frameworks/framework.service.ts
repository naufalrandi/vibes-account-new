import { Framework, FrameworkFamily, FrameworkType } from "../../db/models";
import type { FrameworkStatus } from "../../db/models/framework.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateFrameworkInput {
  code: string;
  name: string;
  familyId: string;
  version?: string | null;
  status?: FrameworkStatus;
  publishedDate?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
}

export type UpdateFrameworkInput = Partial<CreateFrameworkInput>;

export interface ListFrameworkFilters {
  familyId?: string;
}

// Eager-load the parent family and, through it, the family's type so the list
// response carries the nested { FrameworkFamily: { FrameworkType } } shape the
// catalog table renders (Family + Type columns).
const FAMILY_INCLUDE = { model: FrameworkFamily, include: [FrameworkType] };

/** Frameworks are platform-global config — only the Service Owner may touch them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage frameworks");
  }
}

/** Resolve the parent family or fail — keeps the FK reference meaningful at the API layer. */
async function requireFamily(familyId: string): Promise<FrameworkFamily> {
  const family = await FrameworkFamily.findByPk(familyId);
  if (!family) throw new BadRequestError("Framework family does not exist", "FRAMEWORK_FAMILY_NOT_FOUND");
  return family;
}

export async function listFrameworks(
  auth: AuthContext,
  filters: ListFrameworkFilters = {},
): Promise<Framework[]> {
  assertServiceOwner(auth);
  const where = filters.familyId ? { familyId: filters.familyId } : undefined;
  return Framework.findAll({
    where,
    include: [FAMILY_INCLUDE],
    order: [["name", "ASC"]],
  });
}

export async function getFramework(auth: AuthContext, id: string): Promise<Framework> {
  assertServiceOwner(auth);
  const framework = await Framework.findByPk(id, { include: [FAMILY_INCLUDE] });
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  return framework;
}

export async function createFramework(
  auth: AuthContext,
  input: CreateFrameworkInput,
  ip: string | null,
): Promise<Framework> {
  assertServiceOwner(auth);
  await requireFamily(input.familyId);

  const dup = await Framework.findOne({ where: { code: input.code } });
  if (dup) throw new ConflictError("Framework code already exists", "DUPLICATE_CODE");

  const framework = await Framework.create({
    code: input.code,
    name: input.name,
    familyId: input.familyId,
    version: input.version ?? null,
    status: input.status ?? "Draft",
    publishedDate: input.publishedDate ?? null,
    shortDescription: input.shortDescription ?? null,
    fullDescription: input.fullDescription ?? null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "framework.created",
    entityType: "Framework",
    entityId: framework.id,
    sourceIp: ip,
    result: "Success",
  });
  // Reload with the parent family + type so the response matches the list shape.
  return (await Framework.findByPk(framework.id, { include: [FAMILY_INCLUDE] })) ?? framework;
}

export async function updateFramework(
  auth: AuthContext,
  id: string,
  input: UpdateFrameworkInput,
  ip: string | null,
): Promise<Framework> {
  assertServiceOwner(auth);
  const framework = await Framework.findByPk(id);
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  if (input.code !== undefined && input.code !== framework.code) {
    const dup = await Framework.findOne({ where: { code: input.code } });
    if (dup) throw new ConflictError("Framework code already exists", "DUPLICATE_CODE");
    framework.code = input.code;
  }
  if (input.familyId !== undefined && input.familyId !== framework.familyId) {
    await requireFamily(input.familyId);
    framework.familyId = input.familyId;
  }
  if (input.name !== undefined) framework.name = input.name;
  if (input.version !== undefined) framework.version = input.version ?? null;
  if (input.status !== undefined) framework.status = input.status;
  if (input.publishedDate !== undefined) framework.publishedDate = input.publishedDate ?? null;
  if (input.shortDescription !== undefined) framework.shortDescription = input.shortDescription ?? null;
  if (input.fullDescription !== undefined) framework.fullDescription = input.fullDescription ?? null;
  await framework.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "framework.updated",
    entityType: "Framework",
    entityId: framework.id,
    sourceIp: ip,
    result: "Success",
  });
  return (await Framework.findByPk(framework.id, { include: [FAMILY_INCLUDE] })) ?? framework;
}

export async function deleteFramework(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const framework = await Framework.findByPk(id);
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  await framework.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "framework.deleted",
    entityType: "Framework",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
