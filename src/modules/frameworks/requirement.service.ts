import { Framework, FrameworkGroup, FrameworkRequirement, FrameworkElement, RequirementCriterion, ElementRequirementXref } from "../../db/models";
import type { LibraryStatus } from "../../db/models/frameworkMeta.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages requirements");
}

export interface CreateRequirementInput {
  frameworkId: string;
  code: string;
  subject: string;
  description: string;
  shortLabel?: string | null;
  status?: LibraryStatus;
}
export type UpdateRequirementInput = Partial<Omit<CreateRequirementInput, "frameworkId">>;

/** Legacy rows may carry "Assessable"; everything that isn't a Header is a Requirement. */
function normalizeType(type: string | null | undefined): "Header" | "Requirement" {
  return type === "Header" ? "Header" : "Requirement";
}

/**
 * OD `classifyReqArray` (index.html:2241-2248), persisted server-side: a clause
 * with child clauses (`<code>.x` in the same framework) is a structural Header
 * (Assessable=No); a leaf clause is an assessable Requirement. Runs after every
 * requirement create/update/delete so the whole framework stays consistent —
 * adding "9.2.1" silently converts an existing leaf "9.2" into a Header.
 */
async function reclassifyFramework(frameworkId: string): Promise<void> {
  const rows = await FrameworkRequirement.findAll({ where: { frameworkId } });
  for (const r of rows) {
    const hasChild = rows.some((o) => o.id !== r.id && (o.code ?? "").startsWith(`${r.code}.`));
    const type = hasChild ? "Header" : "Requirement";
    if (normalizeType(r.type) !== type) {
      r.type = type;
      await r.save({ silent: true });
    }
  }
}

/** OD reqModal guard: requirement codes are unique (case-insensitive) within their framework. */
async function assertCodeUnique(frameworkId: string, code: string, excludeId?: string): Promise<void> {
  const rows = await FrameworkRequirement.findAll({ where: { frameworkId }, attributes: ["id", "code"] });
  const lc = code.toLowerCase();
  if (rows.some((r) => r.id !== excludeId && (r.code ?? "").toLowerCase() === lc)) {
    throw new ConflictError("This code already exists in this framework", "DUPLICATE_CODE");
  }
}

interface FrameworkRef { name: string; groupName: string }

async function frameworkRefMap(ids: string[]): Promise<Map<string, FrameworkRef>> {
  if (ids.length === 0) return new Map();
  const rows = await Framework.findAll({ where: { id: [...new Set(ids)] }, attributes: ["id", "name", "groupId"] });
  const groups = new Map((await FrameworkGroup.findAll({ attributes: ["id", "name"] })).map((g) => [g.id, g.name]));
  return new Map(rows.map((f) => [f.id, { name: f.name, groupName: f.groupId ? groups.get(f.groupId) ?? "" : "" }]));
}

async function frameworkRef(id: string): Promise<FrameworkRef> {
  return (await frameworkRefMap([id])).get(id) ?? { name: "", groupName: "" };
}

async function mappedElementsFor(requirementId: string): Promise<{ id: string; code: string; name: string }[]> {
  const links = await ElementRequirementXref.findAll({ where: { requirementId }, attributes: ["elementId"] });
  if (links.length === 0) return [];
  const els = await FrameworkElement.findAll({ where: { id: links.map((l) => l.elementId) }, attributes: ["id", "code", "name"] });
  return els.map((e) => ({ id: e.id, code: e.code, name: e.name }));
}

async function toView(r: FrameworkRequirement, fw: FrameworkRef) {
  const criteriaCount = await RequirementCriterion.count({ where: { requirementId: r.id } });
  const type = normalizeType(r.type);
  return {
    id: r.id, frameworkId: r.frameworkId, frameworkName: fw.name, frameworkGroupName: fw.groupName,
    code: r.code, subject: r.subject, description: r.description,
    type, assessable: type === "Header" ? "No" : "Yes",
    shortLabel: r.shortLabel, status: r.status,
    mappedElements: await mappedElementsFor(r.id),
    criteriaCount, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// Read (list/get/listCriteria): catalog data, no orgId — any authenticated
// org may read (mirrors framework.service.ts; mutations stay SO-only below).
export async function listRequirements(auth: AuthContext, frameworkId?: string) {
  const where = frameworkId ? { frameworkId } : undefined;
  const rows = await FrameworkRequirement.findAll({
    where,
    include: [{ model: FrameworkElement, attributes: ["id", "code", "name"], through: { attributes: [] } }],
    order: [["code", "ASC"]],
  });
  const refs = await frameworkRefMap(rows.map((r) => r.frameworkId));
  return Promise.all(
    rows.map(async (r) => {
      const elements = (r.get("FrameworkElements") as FrameworkElement[] | undefined) ?? [];
      const criteriaCount = await RequirementCriterion.count({ where: { requirementId: r.id } });
      const ref = refs.get(r.frameworkId) ?? { name: "", groupName: "" };
      const type = normalizeType(r.type);
      return {
        id: r.id, frameworkId: r.frameworkId, frameworkName: ref.name, frameworkGroupName: ref.groupName,
        code: r.code, subject: r.subject, description: r.description,
        type, assessable: type === "Header" ? "No" : "Yes",
        shortLabel: r.shortLabel, status: r.status,
        mappedElements: elements.map((e) => ({ id: e.id, code: e.code, name: e.name })),
        criteriaCount, createdAt: r.createdAt, updatedAt: r.updatedAt,
      };
    }),
  );
}

async function requireRequirement(id: string): Promise<FrameworkRequirement> {
  const r = await FrameworkRequirement.findByPk(id);
  if (!r) throw new NotFoundError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  return r;
}

export async function getRequirement(auth: AuthContext, id: string) {
  const r = await requireRequirement(id);
  return toView(r, await frameworkRef(r.frameworkId));
}

export async function createRequirement(auth: AuthContext, input: CreateRequirementInput, ip: string | null) {
  assertServiceOwner(auth);
  const fw = await Framework.findByPk(input.frameworkId);
  if (!fw) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  await assertCodeUnique(input.frameworkId, input.code);
  const r = await FrameworkRequirement.create({
    frameworkId: input.frameworkId, code: input.code, subject: input.subject,
    description: input.description, shortLabel: input.shortLabel ?? null, status: input.status ?? "Active",
  });
  // Header/Assessable is derived from the code hierarchy, never authored (OD 2241).
  await reclassifyFramework(input.frameworkId);
  await r.reload();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "requirement.created", entityType: "FrameworkRequirement", entityId: r.id, sourceIp: ip, result: "Success" });
  return toView(r, await frameworkRef(r.frameworkId));
}

export async function updateRequirement(auth: AuthContext, id: string, input: UpdateRequirementInput, ip: string | null) {
  assertServiceOwner(auth);
  const r = await requireRequirement(id);
  const codeChanged = input.code !== undefined && input.code !== r.code;
  if (codeChanged) await assertCodeUnique(r.frameworkId, input.code as string, r.id);
  if (input.code !== undefined) r.code = input.code;
  if (input.subject !== undefined) r.subject = input.subject;
  if (input.description !== undefined) r.description = input.description;
  if (input.shortLabel !== undefined) r.shortLabel = input.shortLabel;
  if (input.status !== undefined) r.status = input.status;
  await r.save();
  if (codeChanged) {
    await reclassifyFramework(r.frameworkId);
    await r.reload();
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "requirement.updated", entityType: "FrameworkRequirement", entityId: r.id, sourceIp: ip, result: "Success" });
  return toView(r, await frameworkRef(r.frameworkId));
}

export async function deleteRequirement(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const r = await requireRequirement(id);
  const frameworkId = r.frameworkId;
  await r.destroy();
  // Removing the last child of a Header turns it back into a leaf Requirement.
  await reclassifyFramework(frameworkId);
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
