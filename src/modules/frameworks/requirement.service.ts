import { Framework, Requirement, Element, Criterion } from "../../db/models";
import type { RequirementStatus } from "../../db/models/requirement.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateRequirementInput {
  frameworkId: string;
  code: string;
  subject: string;
  description: string;
  status?: RequirementStatus;
}

export type UpdateRequirementInput = Partial<Omit<CreateRequirementInput, "frameworkId">>;

export interface ListRequirementFilters {
  frameworkId?: string;
}

export interface RequirementView {
  id: string;
  frameworkId: string;
  frameworkName: string;
  code: string;
  subject: string;
  description: string;
  status: RequirementStatus;
  mappedElements: { id: string; name: string }[];
  criteriaCount: number;
  createdAt: string;
  updatedAt: string;
}

const REQUIREMENT_INCLUDE = [
  { model: Framework },
  { model: Element },
  { model: Criterion, attributes: ["id"] },
];

/** Requirements are platform-global master data — only the Service Owner may manage them. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage requirements");
  }
}

async function requireFramework(frameworkId: string): Promise<Framework> {
  const framework = await Framework.findByPk(frameworkId);
  if (!framework) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  return framework;
}

function toView(requirement: Requirement): RequirementView {
  const framework = requirement.get("Framework") as Framework | undefined;
  const elements = (requirement.get("Elements") as Element[] | undefined) ?? [];
  const criteria = (requirement.get("Criteria") as Criterion[] | undefined) ?? [];
  return {
    id: requirement.id,
    frameworkId: requirement.frameworkId,
    frameworkName: framework?.name ?? "",
    code: requirement.code,
    subject: requirement.subject,
    description: requirement.description,
    status: requirement.status,
    mappedElements: elements
      .map((e) => ({ id: e.id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    criteriaCount: criteria.length,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
  };
}

async function loadView(id: string): Promise<RequirementView> {
  const requirement = await Requirement.findByPk(id, { include: REQUIREMENT_INCLUDE });
  if (!requirement) throw new NotFoundError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  return toView(requirement);
}

export async function listRequirements(
  auth: AuthContext,
  filters: ListRequirementFilters = {},
): Promise<RequirementView[]> {
  assertServiceOwner(auth);
  const where = filters.frameworkId ? { frameworkId: filters.frameworkId } : undefined;
  const rows = await Requirement.findAll({ where, include: REQUIREMENT_INCLUDE, order: [["code", "ASC"]] });
  return rows.map(toView);
}

export async function getRequirement(auth: AuthContext, id: string): Promise<RequirementView> {
  assertServiceOwner(auth);
  return loadView(id);
}

export async function createRequirement(
  auth: AuthContext,
  input: CreateRequirementInput,
  ip: string | null,
): Promise<RequirementView> {
  assertServiceOwner(auth);
  await requireFramework(input.frameworkId);
  const dup = await Requirement.findOne({ where: { frameworkId: input.frameworkId, code: input.code } });
  if (dup) throw new ConflictError("Requirement code already exists in this framework", "DUPLICATE_CODE");

  const requirement = await Requirement.create({
    frameworkId: input.frameworkId,
    code: input.code,
    subject: input.subject,
    description: input.description,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "requirement.created",
    entityType: "Requirement",
    entityId: requirement.id,
    sourceIp: ip,
    result: "Success",
    metadata: { frameworkId: input.frameworkId },
  });
  return loadView(requirement.id);
}

export async function updateRequirement(
  auth: AuthContext,
  id: string,
  input: UpdateRequirementInput,
  ip: string | null,
): Promise<RequirementView> {
  assertServiceOwner(auth);
  const requirement = await Requirement.findByPk(id);
  if (!requirement) throw new NotFoundError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");

  if (input.code !== undefined && input.code !== requirement.code) {
    const dup = await Requirement.findOne({ where: { frameworkId: requirement.frameworkId, code: input.code } });
    if (dup) throw new ConflictError("Requirement code already exists in this framework", "DUPLICATE_CODE");
    requirement.code = input.code;
  }
  if (input.subject !== undefined) requirement.subject = input.subject;
  if (input.description !== undefined) requirement.description = input.description;
  if (input.status !== undefined) requirement.status = input.status;
  await requirement.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "requirement.updated",
    entityType: "Requirement",
    entityId: requirement.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadView(requirement.id);
}

export async function deleteRequirement(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const requirement = await Requirement.findByPk(id);
  if (!requirement) throw new NotFoundError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  await requirement.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "requirement.deleted",
    entityType: "Requirement",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
