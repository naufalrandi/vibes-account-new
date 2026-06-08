import { Framework, Requirement, Element, ElementRequirementMap } from "../../db/models";
import type { ElementStatus } from "../../db/models/element.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateElementInput {
  name: string;
  description?: string | null;
  status?: ElementStatus;
}

export type UpdateElementInput = Partial<CreateElementInput>;

export interface MappedRequirement {
  id: string;
  code: string;
  subject: string;
  description: string;
  frameworkId: string;
  frameworkName: string;
}

export interface ElementView {
  id: string;
  name: string;
  description: string | null;
  status: ElementStatus;
  mappedRequirementCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ElementDetail extends ElementView {
  mappedRequirements: MappedRequirement[];
}

const FRAMEWORK_DEEP = { model: Framework };

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage framework elements");
  }
}

function mappedRequirementOf(requirement: Requirement): MappedRequirement {
  const framework = requirement.get("Framework") as Framework | undefined;
  return {
    id: requirement.id,
    code: requirement.code,
    subject: requirement.subject,
    description: requirement.description,
    frameworkId: requirement.frameworkId,
    frameworkName: framework?.name ?? "",
  };
}

function baseView(element: Element, count: number): ElementView {
  return {
    id: element.id,
    name: element.name,
    description: element.description,
    status: element.status,
    mappedRequirementCount: count,
    createdAt: element.createdAt.toISOString(),
    updatedAt: element.updatedAt.toISOString(),
  };
}

export async function listElements(auth: AuthContext): Promise<ElementView[]> {
  assertServiceOwner(auth);
  const rows = await Element.findAll({
    include: [{ model: Requirement, attributes: ["id"], through: { attributes: [] } }],
    order: [["name", "ASC"]],
  });
  return rows.map((el) => baseView(el, ((el.get("Requirements") as Requirement[] | undefined) ?? []).length));
}

async function loadDetail(id: string): Promise<ElementDetail> {
  const element = await Element.findByPk(id);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  const maps = await ElementRequirementMap.findAll({ where: { elementId: id }, attributes: ["requirementId"] });
  const ids = maps.map((m) => m.requirementId);
  const requirements = ids.length
    ? await Requirement.findAll({ where: { id: ids }, include: [FRAMEWORK_DEEP] })
    : [];
  const mappedRequirements = requirements.map(mappedRequirementOf).sort((a, b) => {
    if (a.frameworkName !== b.frameworkName) return a.frameworkName.localeCompare(b.frameworkName);
    return a.code.localeCompare(b.code);
  });
  return { ...baseView(element, mappedRequirements.length), mappedRequirements };
}

export async function getElement(auth: AuthContext, id: string): Promise<ElementDetail> {
  assertServiceOwner(auth);
  return loadDetail(id);
}

export async function createElement(
  auth: AuthContext,
  input: CreateElementInput,
  ip: string | null,
): Promise<ElementDetail> {
  assertServiceOwner(auth);
  const dup = await Element.findOne({ where: { name: input.name } });
  if (dup) throw new ConflictError("An element with this name already exists", "DUPLICATE_NAME");
  const element = await Element.create({
    name: input.name,
    description: input.description ?? null,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "element.created",
    entityType: "Element",
    entityId: element.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadDetail(element.id);
}

export async function updateElement(
  auth: AuthContext,
  id: string,
  input: UpdateElementInput,
  ip: string | null,
): Promise<ElementDetail> {
  assertServiceOwner(auth);
  const element = await Element.findByPk(id);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  if (input.name !== undefined && input.name !== element.name) {
    const dup = await Element.findOne({ where: { name: input.name } });
    if (dup) throw new ConflictError("An element with this name already exists", "DUPLICATE_NAME");
    element.name = input.name;
  }
  if (input.description !== undefined) element.description = input.description ?? null;
  if (input.status !== undefined) element.status = input.status;
  await element.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "element.updated",
    entityType: "Element",
    entityId: element.id,
    sourceIp: ip,
    result: "Success",
  });
  return loadDetail(element.id);
}

export async function deleteElement(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const element = await Element.findByPk(id);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  await element.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "element.deleted",
    entityType: "Element",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

/** Replace the full set of requirements mapped to an element (the mapping drawer). */
export async function setElementMappings(
  auth: AuthContext,
  elementId: string,
  requirementIds: string[],
  ip: string | null,
): Promise<ElementDetail> {
  assertServiceOwner(auth);
  const element = await Element.findByPk(elementId);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");

  const unique = [...new Set(requirementIds)];
  if (unique.length) {
    const found = await Requirement.findAll({ where: { id: unique }, attributes: ["id"] });
    if (found.length !== unique.length) {
      throw new BadRequestError("One or more requirements do not exist", "REQUIREMENT_NOT_FOUND");
    }
  }
  const desired = new Set(unique);
  const current = await ElementRequirementMap.findAll({ where: { elementId } });
  const currentIds = new Set(current.map((m) => m.requirementId));
  for (const m of current) if (!desired.has(m.requirementId)) await m.destroy();
  for (const rid of unique) if (!currentIds.has(rid)) await ElementRequirementMap.create({ elementId, requirementId: rid });

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "frameworkMapping.updated",
    entityType: "Element",
    entityId: elementId,
    sourceIp: ip,
    result: "Success",
    metadata: { mappedRequirementCount: unique.length },
  });
  return loadDetail(elementId);
}
