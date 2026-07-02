import {
  Framework, FrameworkFamily, FrameworkType, FrameworkGroup, FrameworkRequirement,
} from "../../db/models";
import type { FrameworkStatus } from "../../db/models/framework.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateFrameworkInput {
  name: string;
  // Catalog shape (Type→Family→Framework).
  code?: string;
  familyId?: string;
  version?: string | null;
  publishedDate?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  // Meta-model shape (group-based Framework Library, Phase 7).
  groupId?: string;
  description?: string | null;
  jurisdictions?: string[];
  status?: FrameworkStatus;
}

export type UpdateFrameworkInput = Partial<CreateFrameworkInput>;

export interface ListFrameworkFilters {
  familyId?: string;
  groupId?: string;
}

// Eager-load the parent family + type (catalog nesting) and the group (meta-model).
const INCLUDES = [{ model: FrameworkFamily, include: [FrameworkType] }, { model: FrameworkGroup }];

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage frameworks");
  }
}

async function requireFamily(familyId: string): Promise<FrameworkFamily> {
  const family = await FrameworkFamily.findByPk(familyId);
  if (!family) throw new BadRequestError("Framework family does not exist", "FRAMEWORK_FAMILY_NOT_FOUND");
  return family;
}

/**
 * Project a framework to a response that carries BOTH the catalog fields (code,
 * FrameworkFamily nesting — relied on by the catalog tree/tests) AND the
 * meta-model fields the frontend Framework Library reads (groupId, groupName,
 * jurisdictions, description, requirementCount).
 */
async function toView(f: Framework): Promise<Record<string, unknown>> {
  const group = f.get("FrameworkGroup") as FrameworkGroup | undefined;
  const requirementCount = await FrameworkRequirement.count({ where: { frameworkId: f.id } });
  return {
    ...f.toJSON(),
    groupId: f.groupId,
    groupName: group?.name ?? "",
    description: f.shortDescription,
    jurisdictions: f.jurisdictions ?? [],
    requirementCount,
  };
}

export async function listFrameworks(auth: AuthContext, filters: ListFrameworkFilters = {}): Promise<Record<string, unknown>[]> {
  assertServiceOwner(auth);
  const where: Record<string, unknown> = {};
  if (filters.familyId) where.familyId = filters.familyId;
  if (filters.groupId) where.groupId = filters.groupId;
  const rows = await Framework.findAll({
    where: Object.keys(where).length ? where : undefined,
    include: INCLUDES,
    order: [["name", "ASC"]],
  });
  return Promise.all(rows.map(toView));
}

export async function getFramework(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
  assertServiceOwner(auth);
  const f = await Framework.findByPk(id, { include: INCLUDES });
  if (!f) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  return toView(f);
}

/**
 * The Library ships two fixed framework groups (Standards / Regulations). Ensure
 * they exist lazily — mirrors the scope-dataset lazy-seed pattern so both fresh
 * databases and the test harness (which runs migrations only, not the seeder)
 * always expose them.
 */
async function ensureGroups(): Promise<void> {
  await FrameworkGroup.findOrCreate({ where: { name: "Standards" }, defaults: { name: "Standards", sortOrder: 1 } });
  await FrameworkGroup.findOrCreate({ where: { name: "Regulations" }, defaults: { name: "Regulations", sortOrder: 2 } });
}

export async function listGroups(auth: AuthContext): Promise<{ id: string; name: string }[]> {
  assertServiceOwner(auth);
  await ensureGroups();
  const groups = await FrameworkGroup.findAll({ order: [["sortOrder", "ASC"], ["name", "ASC"]] });
  return groups.map((g) => ({ id: g.id, name: g.name }));
}

export async function createFramework(auth: AuthContext, input: CreateFrameworkInput, ip: string | null): Promise<Record<string, unknown>> {
  assertServiceOwner(auth);

  let created: Framework;
  if (input.familyId) {
    // Catalog create (requires code + family).
    await requireFamily(input.familyId);
    if (!input.code) throw new BadRequestError("Catalog frameworks require a code", "CODE_REQUIRED");
    if (await Framework.findOne({ where: { code: input.code } })) {
      throw new ConflictError("Framework code already exists", "DUPLICATE_CODE");
    }
    created = await Framework.create({
      familyId: input.familyId, code: input.code, name: input.name,
      version: input.version ?? null, status: input.status ?? "Draft",
      publishedDate: input.publishedDate ?? null,
      shortDescription: input.shortDescription ?? null, fullDescription: input.fullDescription ?? null,
      groupId: null, jurisdictions: [],
    });
  } else {
    // Meta-model create (group-based Framework Library).
    if (input.groupId && !(await FrameworkGroup.findByPk(input.groupId))) {
      throw new BadRequestError("Framework group does not exist", "GROUP_NOT_FOUND");
    }
    created = await Framework.create({
      familyId: null, code: null, name: input.name,
      version: null, status: input.status ?? "Active",
      publishedDate: null, shortDescription: input.description ?? null, fullDescription: null,
      groupId: input.groupId ?? null, jurisdictions: input.jurisdictions ?? [],
    });
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "framework.created", entityType: "Framework", entityId: created.id, sourceIp: ip, result: "Success" });
  return getFramework(auth, created.id);
}

export async function updateFramework(auth: AuthContext, id: string, input: UpdateFrameworkInput, ip: string | null): Promise<Record<string, unknown>> {
  assertServiceOwner(auth);
  const f = await Framework.findByPk(id);
  if (!f) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  if (input.code !== undefined && input.code !== f.code) {
    if (input.code && (await Framework.findOne({ where: { code: input.code } }))) {
      throw new ConflictError("Framework code already exists", "DUPLICATE_CODE");
    }
    f.code = input.code ?? null;
  }
  if (input.familyId !== undefined) { await requireFamily(input.familyId); f.familyId = input.familyId; }
  if (input.groupId !== undefined) {
    if (input.groupId && !(await FrameworkGroup.findByPk(input.groupId))) throw new BadRequestError("Framework group does not exist", "GROUP_NOT_FOUND");
    f.groupId = input.groupId;
  }
  if (input.name !== undefined) f.name = input.name;
  if (input.version !== undefined) f.version = input.version ?? null;
  if (input.status !== undefined) f.status = input.status;
  if (input.publishedDate !== undefined) f.publishedDate = input.publishedDate ?? null;
  if (input.description !== undefined) f.shortDescription = input.description ?? null;
  if (input.shortDescription !== undefined) f.shortDescription = input.shortDescription ?? null;
  if (input.fullDescription !== undefined) f.fullDescription = input.fullDescription ?? null;
  if (input.jurisdictions !== undefined) f.jurisdictions = input.jurisdictions;
  await f.save();

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "framework.updated", entityType: "Framework", entityId: f.id, sourceIp: ip, result: "Success" });
  return getFramework(auth, f.id);
}

export async function deleteFramework(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const f = await Framework.findByPk(id);
  if (!f) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
  await f.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "framework.deleted", entityType: "Framework", entityId: id, sourceIp: ip, result: "Success" });
}
