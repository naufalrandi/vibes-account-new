import { FrameworkType, FrameworkFamily, Framework } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateFrameworkFamilyInput {
  code: string;
  name: string;
  frameworkTypeId: string;
  sortOrder?: number;
  status?: "Active" | "Inactive";
  description?: string | null;
}

export type UpdateFrameworkFamilyInput = Partial<CreateFrameworkFamilyInput>;

export interface ListFrameworkFamilyFilters {
  frameworkTypeId?: string;
}

/** Framework families are platform-global config — only the Service Owner may touch them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage framework families");
  }
}

/** Resolve the parent type or fail — keeps the FK reference meaningful at the API layer. */
async function requireType(frameworkTypeId: string): Promise<FrameworkType> {
  const type = await FrameworkType.findByPk(frameworkTypeId);
  if (!type) throw new BadRequestError("Framework type does not exist", "FRAMEWORK_TYPE_NOT_FOUND");
  return type;
}

export async function listFrameworkFamilies(
  auth: AuthContext,
  filters: ListFrameworkFamilyFilters = {},
): Promise<FrameworkFamily[]> {
  assertServiceOwner(auth);
  const where = filters.frameworkTypeId ? { frameworkTypeId: filters.frameworkTypeId } : undefined;
  return FrameworkFamily.findAll({
    where,
    // "with their parent type included" — eager-load the type for the table pill.
    include: [FrameworkType],
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"],
    ],
  });
}

export async function getFrameworkFamily(auth: AuthContext, id: string): Promise<FrameworkFamily> {
  assertServiceOwner(auth);
  const family = await FrameworkFamily.findByPk(id, { include: [FrameworkType] });
  if (!family) throw new NotFoundError("Framework family does not exist", "FRAMEWORK_FAMILY_NOT_FOUND");
  return family;
}

export async function createFrameworkFamily(
  auth: AuthContext,
  input: CreateFrameworkFamilyInput,
  ip: string | null,
): Promise<FrameworkFamily> {
  assertServiceOwner(auth);
  await requireType(input.frameworkTypeId);

  const dup = await FrameworkFamily.findOne({ where: { code: input.code } });
  if (dup) throw new ConflictError("Framework family code already exists", "DUPLICATE_CODE");

  const family = await FrameworkFamily.create({
    code: input.code,
    name: input.name,
    frameworkTypeId: input.frameworkTypeId,
    sortOrder: input.sortOrder ?? 0,
    status: input.status ?? "Active",
    description: input.description ?? null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkFamily.created",
    entityType: "FrameworkFamily",
    entityId: family.id,
    sourceIp: ip,
    result: "Success",
  });
  // Reload with the parent type so the response matches the list shape.
  return (await FrameworkFamily.findByPk(family.id, { include: [FrameworkType] })) ?? family;
}

export async function updateFrameworkFamily(
  auth: AuthContext,
  id: string,
  input: UpdateFrameworkFamilyInput,
  ip: string | null,
): Promise<FrameworkFamily> {
  assertServiceOwner(auth);
  const family = await FrameworkFamily.findByPk(id);
  if (!family) throw new NotFoundError("Framework family does not exist", "FRAMEWORK_FAMILY_NOT_FOUND");

  if (input.code !== undefined && input.code !== family.code) {
    const dup = await FrameworkFamily.findOne({ where: { code: input.code } });
    if (dup) throw new ConflictError("Framework family code already exists", "DUPLICATE_CODE");
    family.code = input.code;
  }
  if (input.frameworkTypeId !== undefined && input.frameworkTypeId !== family.frameworkTypeId) {
    await requireType(input.frameworkTypeId);
    family.frameworkTypeId = input.frameworkTypeId;
  }
  if (input.name !== undefined) family.name = input.name;
  if (input.sortOrder !== undefined) family.sortOrder = input.sortOrder;
  if (input.status !== undefined) family.status = input.status;
  if (input.description !== undefined) family.description = input.description ?? null;
  await family.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkFamily.updated",
    entityType: "FrameworkFamily",
    entityId: family.id,
    sourceIp: ip,
    result: "Success",
  });
  return (await FrameworkFamily.findByPk(family.id, { include: [FrameworkType] })) ?? family;
}

export async function deleteFrameworkFamily(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const family = await FrameworkFamily.findByPk(id);
  if (!family) throw new NotFoundError("Framework family does not exist", "FRAMEWORK_FAMILY_NOT_FOUND");

  const linked = await Framework.count({ where: { familyId: id } });
  if (linked > 0) {
    throw new ConflictError(
      "Cannot delete a framework family that has linked frameworks",
      "FRAMEWORK_FAMILY_IN_USE",
    );
  }

  await family.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkFamily.deleted",
    entityType: "FrameworkFamily",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
