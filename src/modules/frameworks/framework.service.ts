import { Framework, FrameworkGroup, Requirement } from "../../db/models";
import type { FrameworkStatus } from "../../db/models/framework.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateFrameworkInput {
  groupId: string;
  name: string;
  description?: string | null;
  jurisdictions?: string[];
  status?: FrameworkStatus;
}

export type UpdateFrameworkInput = Partial<CreateFrameworkInput>;

export interface ListFrameworkFilters {
  groupId?: string;
}

export interface FrameworkView {
  id: string;
  groupId: string | null;
  groupName: string;
  name: string;
  description: string | null;
  jurisdictions: string[];
  status: FrameworkStatus;
  requirementCount: number;
  createdAt: string;
  updatedAt: string;
}

const FRAMEWORK_INCLUDE = [{ model: FrameworkGroup }, { model: Requirement, attributes: ["id"] }];

/** Frameworks are platform-global master data — only the Service Owner may manage them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage frameworks");
  }
}

async function requireGroup(groupId: string): Promise<FrameworkGroup> {
  const group = await FrameworkGroup.findByPk(groupId);
  if (!group) throw new BadRequestError("Framework group does not exist", "FRAMEWORK_GROUP_NOT_FOUND");
  return group;
}

function toView(framework: Framework): FrameworkView {
  const group = framework.get("FrameworkGroup") as FrameworkGroup | undefined;
  const requirements = (framework.get("Requirements") as Requirement[] | undefined) ?? [];
  return {
    id: framework.id,
    groupId: framework.groupId,
    groupName: group?.name ?? "",
    name: framework.name,
    description: framework.description,
    jurisdictions: framework.jurisdictions ?? [],
    status: framework.status,
    requirementCount: requirements.length,
    createdAt: framework.createdAt.toISOString(),
    updatedAt: framework.updatedAt.toISOString(),
  };
}

async function loadView(id: string): Promise<FrameworkView> {
  const framework = await Framework.findByPk(id, { include: FRAMEWORK_INCLUDE });
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  return toView(framework);
}

export async function listFrameworks(auth: AuthContext, filters: ListFrameworkFilters = {}): Promise<FrameworkView[]> {
  assertServiceOwner(auth);
  const where = filters.groupId ? { groupId: filters.groupId } : undefined;
  const rows = await Framework.findAll({ where, include: FRAMEWORK_INCLUDE, order: [["name", "ASC"]] });
  return rows.map(toView);
}

export async function getFramework(auth: AuthContext, id: string): Promise<FrameworkView> {
  assertServiceOwner(auth);
  return loadView(id);
}

export async function createFramework(
  auth: AuthContext,
  input: CreateFrameworkInput,
  ip: string | null,
): Promise<FrameworkView> {
  assertServiceOwner(auth);
  await requireGroup(input.groupId);
  const framework = await Framework.create({
    groupId: input.groupId,
    name: input.name,
    description: input.description ?? null,
    jurisdictions: input.jurisdictions ?? [],
    status: input.status ?? "Active",
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
  return loadView(framework.id);
}

export async function updateFramework(
  auth: AuthContext,
  id: string,
  input: UpdateFrameworkInput,
  ip: string | null,
): Promise<FrameworkView> {
  assertServiceOwner(auth);
  const framework = await Framework.findByPk(id);
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  if (input.groupId !== undefined && input.groupId !== framework.groupId) {
    await requireGroup(input.groupId);
    framework.groupId = input.groupId;
  }
  if (input.name !== undefined) framework.name = input.name;
  if (input.description !== undefined) framework.description = input.description ?? null;
  if (input.jurisdictions !== undefined) framework.jurisdictions = input.jurisdictions;
  if (input.status !== undefined) framework.status = input.status;
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
  return loadView(framework.id);
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
