import { Framework, FrameworkRequirement, FrameworkElement, RequirementCriterion, ElementRequirementXref } from "../../db/models";
import type { LibraryStatus } from "../../db/models/frameworkMeta.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages requirements");
}

export interface CreateRequirementInput {
  frameworkId: string;
  code: string;
  subject: string;
  description: string;
  status?: LibraryStatus;
}
export type UpdateRequirementInput = Partial<Omit<CreateRequirementInput, "frameworkId">>;

async function frameworkNameMap(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await Framework.findAll({ where: { id: [...new Set(ids)] }, attributes: ["id", "name"] });
  return new Map(rows.map((f) => [f.id, f.name]));
}

async function mappedElementsFor(requirementId: string): Promise<{ id: string; name: string }[]> {
  const links = await ElementRequirementXref.findAll({ where: { requirementId }, attributes: ["elementId"] });
  if (links.length === 0) return [];
  const els = await FrameworkElement.findAll({ where: { id: links.map((l) => l.elementId) }, attributes: ["id", "name"] });
  return els.map((e) => ({ id: e.id, name: e.name }));
}

async function toView(r: FrameworkRequirement, frameworkName: string) {
  const criteriaCount = await RequirementCriterion.count({ where: { requirementId: r.id } });
  return {
    id: r.id, frameworkId: r.frameworkId, frameworkName,
    code: r.code, subject: r.subject, description: r.description, status: r.status,
    mappedElements: await mappedElementsFor(r.id),
    criteriaCount, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listRequirements(auth: AuthContext, frameworkId?: string) {
  assertServiceOwner(auth);
  const where = frameworkId ? { frameworkId } : undefined;
  const rows = await FrameworkRequirement.findAll({
    where,
    include: [{ model: FrameworkElement, attributes: ["id", "name"], through: { attributes: [] } }],
    order: [["code", "ASC"]],
  });
  const names = await frameworkNameMap(rows.map((r) => r.frameworkId));
  return Promise.all(
    rows.map(async (r) => {
      const elements = (r.get("FrameworkElements") as FrameworkElement[] | undefined) ?? [];
      const criteriaCount = await RequirementCriterion.count({ where: { requirementId: r.id } });
      return {
        id: r.id, frameworkId: r.frameworkId, frameworkName: names.get(r.frameworkId) ?? "",
        code: r.code, subject: r.subject, description: r.description, status: r.status,
        mappedElements: elements.map((e) => ({ id: e.id, name: e.name })),
        criteriaCount, createdAt: r.createdAt, updatedAt: r.updatedAt,
      };
    }),
  );
}

async function require(id: string): Promise<FrameworkRequirement> {
  const r = await FrameworkRequirement.findByPk(id);
  if (!r) throw new NotFoundError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  return r;
}

export async function getRequirement(auth: AuthContext, id: string) {
  assertServiceOwner(auth);
  const r = await require(id);
  const fw = await Framework.findByPk(r.frameworkId);
  return toView(r, fw?.name ?? "");
}

export async function createRequirement(auth: AuthContext, input: CreateRequirementInput, ip: string | null) {
  assertServiceOwner(auth);
  const fw = await Framework.findByPk(input.frameworkId);
  if (!fw) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  const r = await FrameworkRequirement.create({
    frameworkId: input.frameworkId, code: input.code, subject: input.subject,
    description: input.description, status: input.status ?? "Active",
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "requirement.created", entityType: "FrameworkRequirement", entityId: r.id, sourceIp: ip, result: "Success" });
  return toView(r, fw.name);
}

export async function updateRequirement(auth: AuthContext, id: string, input: UpdateRequirementInput, ip: string | null) {
  assertServiceOwner(auth);
  const r = await require(id);
  if (input.code !== undefined) r.code = input.code;
  if (input.subject !== undefined) r.subject = input.subject;
  if (input.description !== undefined) r.description = input.description;
  if (input.status !== undefined) r.status = input.status;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "requirement.updated", entityType: "FrameworkRequirement", entityId: r.id, sourceIp: ip, result: "Success" });
  const fw = await Framework.findByPk(r.frameworkId);
  return toView(r, fw?.name ?? "");
}

export async function deleteRequirement(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const r = await require(id);
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "requirement.deleted", entityType: "FrameworkRequirement", entityId: id, sourceIp: ip, result: "Success" });
}

// --- Criteria ------------------------------------------------------------
export interface CreateCriterionInput {
  requirementId: string;
  score: number;
  description: string;
}
export type UpdateCriterionInput = Partial<Omit<CreateCriterionInput, "requirementId">>;

function critView(c: RequirementCriterion) {
  return { id: c.id, requirementId: c.requirementId, score: c.score, description: c.description, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export async function listCriteria(auth: AuthContext, requirementId: string) {
  assertServiceOwner(auth);
  const rows = await RequirementCriterion.findAll({ where: { requirementId }, order: [["score", "ASC"]] });
  return rows.map(critView);
}

export async function createCriterion(auth: AuthContext, input: CreateCriterionInput, ip: string | null) {
  assertServiceOwner(auth);
  if (input.score < 0 || input.score > 9) throw new BadRequestError("Score must be between 0 and 9", "BAD_SCORE");
  if (!(await FrameworkRequirement.findByPk(input.requirementId))) throw new BadRequestError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  const c = await RequirementCriterion.create({ requirementId: input.requirementId, score: input.score, description: input.description });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "criterion.created", entityType: "RequirementCriterion", entityId: c.id, sourceIp: ip, result: "Success" });
  return critView(c);
}

export async function updateCriterion(auth: AuthContext, id: string, input: UpdateCriterionInput, ip: string | null) {
  assertServiceOwner(auth);
  const c = await RequirementCriterion.findByPk(id);
  if (!c) throw new NotFoundError("Criterion does not exist", "CRITERION_NOT_FOUND");
  if (input.score !== undefined) {
    if (input.score < 0 || input.score > 9) throw new BadRequestError("Score must be between 0 and 9", "BAD_SCORE");
    c.score = input.score;
  }
  if (input.description !== undefined) c.description = input.description;
  await c.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "criterion.updated", entityType: "RequirementCriterion", entityId: c.id, sourceIp: ip, result: "Success" });
  return critView(c);
}

export async function deleteCriterion(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const c = await RequirementCriterion.findByPk(id);
  if (!c) throw new NotFoundError("Criterion does not exist", "CRITERION_NOT_FOUND");
  await c.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "criterion.deleted", entityType: "RequirementCriterion", entityId: id, sourceIp: ip, result: "Success" });
}
