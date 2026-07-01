import { FrameworkType, FrameworkFamily } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateFrameworkTypeInput {
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  status?: "Active" | "Inactive";
}

export type UpdateFrameworkTypeInput = Partial<CreateFrameworkTypeInput>;

/** Framework types are platform-global config — only the Service Owner may touch them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage framework types");
  }
}

export async function listFrameworkTypes(auth: AuthContext): Promise<FrameworkType[]> {
  assertServiceOwner(auth);
  return FrameworkType.findAll({ order: [["sortOrder", "ASC"], ["name", "ASC"]] });
}

export async function getFrameworkType(auth: AuthContext, id: string): Promise<FrameworkType> {
  assertServiceOwner(auth);
  const ft = await FrameworkType.findByPk(id);
  if (!ft) throw new NotFoundError("Framework type does not exist", "FRAMEWORK_TYPE_NOT_FOUND");
  return ft;
}

export async function createFrameworkType(
  auth: AuthContext,
  input: CreateFrameworkTypeInput,
  ip: string | null,
): Promise<FrameworkType> {
  assertServiceOwner(auth);
  const dup = await FrameworkType.findOne({ where: { code: input.code } });
  if (dup) throw new ConflictError("Framework type code already exists", "DUPLICATE_CODE");

  const ft = await FrameworkType.create({
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    sortOrder: input.sortOrder ?? 0,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkType.created",
    entityType: "FrameworkType",
    entityId: ft.id,
    sourceIp: ip,
    result: "Success",
  });
  return ft;
}

export async function updateFrameworkType(
  auth: AuthContext,
  id: string,
  input: UpdateFrameworkTypeInput,
  ip: string | null,
): Promise<FrameworkType> {
  assertServiceOwner(auth);
  const ft = await FrameworkType.findByPk(id);
  if (!ft) throw new NotFoundError("Framework type does not exist", "FRAMEWORK_TYPE_NOT_FOUND");

  if (input.code !== undefined && input.code !== ft.code) {
    const dup = await FrameworkType.findOne({ where: { code: input.code } });
    if (dup) throw new ConflictError("Framework type code already exists", "DUPLICATE_CODE");
    ft.code = input.code;
  }
  if (input.name !== undefined) ft.name = input.name;
  if (input.description !== undefined) ft.description = input.description ?? null;
  if (input.sortOrder !== undefined) ft.sortOrder = input.sortOrder;
  if (input.status !== undefined) ft.status = input.status;
  await ft.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkType.updated",
    entityType: "FrameworkType",
    entityId: ft.id,
    sourceIp: ip,
    result: "Success",
  });
  return ft;
}

export async function deleteFrameworkType(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const ft = await FrameworkType.findByPk(id);
  if (!ft) throw new NotFoundError("Framework type does not exist", "FRAMEWORK_TYPE_NOT_FOUND");

  const linked = await FrameworkFamily.count({ where: { frameworkTypeId: id } });
  if (linked > 0) {
    throw new ConflictError(
      "Cannot delete a framework type that has linked framework families",
      "FRAMEWORK_TYPE_IN_USE",
    );
  }

  await ft.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkType.deleted",
    entityType: "FrameworkType",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
