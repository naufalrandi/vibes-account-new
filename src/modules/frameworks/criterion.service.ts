import { Criterion, Requirement } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateCriterionInput {
  requirementId: string;
  score: number;
  description: string;
}

export type UpdateCriterionInput = Partial<Pick<CreateCriterionInput, "score" | "description">>;

export interface CriterionView {
  id: string;
  requirementId: string;
  score: number;
  description: string;
  createdAt: string;
  updatedAt: string;
}

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage assessment criteria");
  }
}

function toView(c: Criterion): CriterionView {
  return {
    id: c.id,
    requirementId: c.requirementId,
    score: c.score,
    description: c.description,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listCriteria(auth: AuthContext, requirementId: string): Promise<CriterionView[]> {
  assertServiceOwner(auth);
  const rows = await Criterion.findAll({ where: { requirementId }, order: [["score", "ASC"]] });
  return rows.map(toView);
}

export async function createCriterion(
  auth: AuthContext,
  input: CreateCriterionInput,
  ip: string | null,
): Promise<CriterionView> {
  assertServiceOwner(auth);
  if (input.score < 0 || input.score > 9) throw new BadRequestError("Score must be between 0 and 9", "INVALID_SCORE");
  const requirement = await Requirement.findByPk(input.requirementId);
  if (!requirement) throw new BadRequestError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  const dup = await Criterion.findOne({ where: { requirementId: input.requirementId, score: input.score } });
  if (dup) throw new ConflictError("A criterion with this score already exists for the requirement", "DUPLICATE_SCORE");

  const criterion = await Criterion.create({
    requirementId: input.requirementId,
    score: input.score,
    description: input.description,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "criterion.created",
    entityType: "Criterion",
    entityId: criterion.id,
    sourceIp: ip,
    result: "Success",
  });
  return toView(criterion);
}

export async function updateCriterion(
  auth: AuthContext,
  id: string,
  input: UpdateCriterionInput,
  ip: string | null,
): Promise<CriterionView> {
  assertServiceOwner(auth);
  const criterion = await Criterion.findByPk(id);
  if (!criterion) throw new NotFoundError("Criterion does not exist", "CRITERION_NOT_FOUND");
  if (input.score !== undefined && input.score !== criterion.score) {
    if (input.score < 0 || input.score > 9) throw new BadRequestError("Score must be between 0 and 9", "INVALID_SCORE");
    const dup = await Criterion.findOne({ where: { requirementId: criterion.requirementId, score: input.score } });
    if (dup) throw new ConflictError("A criterion with this score already exists for the requirement", "DUPLICATE_SCORE");
    criterion.score = input.score;
  }
  if (input.description !== undefined) criterion.description = input.description;
  await criterion.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "criterion.updated",
    entityType: "Criterion",
    entityId: criterion.id,
    sourceIp: ip,
    result: "Success",
  });
  return toView(criterion);
}

export async function deleteCriterion(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const criterion = await Criterion.findByPk(id);
  if (!criterion) throw new NotFoundError("Criterion does not exist", "CRITERION_NOT_FOUND");
  await criterion.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "criterion.deleted",
    entityType: "Criterion",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
